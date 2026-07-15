// Shared KML parser — runs in the browser (native DOMParser) and in Node
// (inject @xmldom/xmldom's DOMParser). Turns a Google My Maps KML string into
// an array of Person records. Image *downloading* is a build concern; this
// returns each photo's Google `src` with `local: null` for the build to fill.

const COLOR_TO_CATEGORY = {
  '0288D1': 'Missing Males',
  '1A237E': 'Unidentified Males',
  E65100: 'Missing Females',
  FF5252: 'Missing Females',
  A52714: 'Unidentified Females',
};

const LINK_LABELS = [
  [/namus\.gov/i, 'NamUs'],
  [/doenetwork\.org/i, 'The Doe Network'],
  [/charleyproject\.org/i, 'The Charley Project'],
  [/bci\.utah\.gov/i, 'Utah BCI Cold Cases'],
  [/findagrave\.com/i, 'Find a Grave'],
  [/facebook\.com/i, 'Facebook'],
];

const IMAGE_HOST = 'mymaps.usercontent.google.com';
const HOTLINE = '833-DPS-SAFE (833-377-7233)';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name] ?? `&${name};`);
}

export function slugify(str) {
  return str
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'record';
}

// "Lester McAllister, 1918" -> 1918 ; "1934 John Doe - Davis County" -> 1934
export function extractYear(name) {
  const m = name.match(/\b(1[89]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

// Remove a leading "YYYY " or trailing ", YYYY" so the display name is clean.
export function cleanName(name) {
  let n = name.trim();
  n = n.replace(/,\s*(1[89]\d\d|20\d\d)\s*$/, '');
  n = n.replace(/^(1[89]\d\d|20\d\d)\s+/, '');
  return n.trim() || name.trim();
}

function categoryFacets(category) {
  const type = /unidentified/i.test(category) ? 'Unidentified' : 'Missing';
  const gender = /female/i.test(category) ? 'Female' : 'Male';
  const locationLabel = type === 'Missing' ? 'Last known location' : 'Location found';
  return { type, gender, locationLabel };
}

function text(el) {
  return el && el.textContent != null ? el.textContent.trim() : '';
}

// Direct-child element by tag name (avoids grabbing nested placemark <name>).
function childByTag(parent, tag) {
  for (const node of parent.childNodes || []) {
    if (node.nodeType === 1 && (node.tagName === tag || node.localName === tag)) return node;
  }
  return null;
}

function extractPhotos(placemark, descHtml) {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    const url = (u || '').trim();
    if (url && /^https?:\/\//.test(url) && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };
  // Primary: <ExtendedData><Data name="gx_media_links"><value>url url ...</value>
  for (const d of placemark.getElementsByTagName('Data')) {
    if (d.getAttribute && d.getAttribute('name') === 'gx_media_links') {
      const value = d.getElementsByTagName('value')[0];
      text(value).split(/\s+/).forEach(push);
    }
  }
  // Fallback: <img src> inside the description HTML.
  for (const m of descHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)) push(m[1]);
  return urls.map((src) => ({ src, local: null }));
}

// Turn the description HTML into { narrative, caseNumber, links[] }.
function parseDescription(descHtml) {
  // Strip images, convert <br> to newlines, drop remaining tags, decode entities.
  let plain = descHtml
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  plain = decodeEntities(plain);

  // Case number — tolerant of "Case #0042753" and "Case #: 24-L12250"; the
  // leading [A-Za-z0-9] guard means it won't match a NamUs URL's "Case#/53417".
  const caseMatch = plain.match(/Case\s*#:?\s*([A-Za-z0-9][A-Za-z0-9-]*)/);
  const caseNumber = caseMatch ? caseMatch[1] : null;

  const links = [];
  const linkSeen = new Set();
  const lines = plain.split('\n');
  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      kept.push('');
      continue;
    }
    // Non-image URLs on this line become structured links; the line is dropped.
    const urls = [...line.matchAll(/https?:\/\/[^\s<>()\]]+/g)]
      .map((m) => m[0].replace(/[.,)\]]+$/, ''))
      .filter((u) => !u.includes(IMAGE_HOST));
    if (urls.length) {
      const labelMatch = line.match(/^(.*?):\s*https?:\/\//);
      for (const url of urls) {
        if (linkSeen.has(url)) continue;
        linkSeen.add(url);
        let label = labelMatch && labelMatch[1].trim();
        if (!label) label = LINK_LABELS.find(([re]) => re.test(url))?.[1];
        if (!label) {
          try {
            label = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            label = url;
          }
        }
        links.push({ label, url });
      }
      continue;
    }
    // Drop hotline boilerplate and the "No Case #, No Links" filler.
    if (/cold case tip (hot)?line|833-?DPS-?SAFE|833-?377-?7233/i.test(line)) continue;
    if (/^no case #|no links/i.test(line)) continue;
    kept.push(line);
  }
  const narrative = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { narrative, caseNumber, links };
}

/**
 * @param {string} kmlString raw KML text
 * @param {typeof DOMParser} DomParser DOMParser class (browser default; inject @xmldom in Node)
 * @returns {Array<object>} Person records
 */
export function parseKml(kmlString, DomParser = globalThis.DOMParser) {
  if (!DomParser) throw new Error('parseKml: no DOMParser available');
  const doc = new DomParser().parseFromString(kmlString, 'text/xml');
  const perr = doc.getElementsByTagName('parsererror');
  if (perr && perr.length) throw new Error('parseKml: invalid KML XML');

  const people = [];
  const idCounts = new Map();
  const makeId = (base) => {
    const n = (idCounts.get(base) || 0) + 1;
    idCounts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const folders = [...doc.getElementsByTagName('Folder')];
  // Placemarks may live in a folder (category from folder name) or top-level.
  const groups = folders.length
    ? folders.map((f) => ({ category: text(childByTag(f, 'name')), placemarks: [...f.getElementsByTagName('Placemark')] }))
    : [{ category: null, placemarks: [...doc.getElementsByTagName('Placemark')] }];

  for (const group of groups) {
    for (const pm of group.placemarks) {
      const rawName = text(pm.getElementsByTagName('name')[0]);
      if (!rawName) continue;

      const styleUrl = text(pm.getElementsByTagName('styleUrl')[0]);
      const color = (styleUrl.match(/([0-9A-Fa-f]{6})/) || [])[1]?.toUpperCase();
      const category = group.category || COLOR_TO_CATEGORY[color] || 'Missing Males';
      const { type, gender, locationLabel } = categoryFacets(category);

      const coordsRaw = text(pm.getElementsByTagName('coordinates')[0]);
      const [lng, lat] = coordsRaw.split(',').map(Number); // KML order: lng,lat,alt
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const descHtml = text(pm.getElementsByTagName('description')[0]);
      const { narrative, caseNumber, links } = parseDescription(descHtml);
      const photos = extractPhotos(pm, descHtml);

      const name = cleanName(rawName);
      const year = extractYear(rawName);
      const id = makeId(`${slugify(name)}${year ? `-${year}` : ''}`);
      const tipHotline = /833-?DPS-?SAFE|833-?377-?7233/i.test(descHtml) ? HOTLINE : null;

      people.push({
        id,
        name,
        year,
        category,
        type,
        gender,
        lat,
        lng,
        locationLabel,
        photos,
        narrative,
        caseNumber,
        links,
        tipHotline,
      });
    }
  }
  return people;
}
