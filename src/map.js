// Leaflet map: soft CARTO basemap, category-colored pins, clustering.
const L = globalThis.L;

export const CATEGORY_STYLES = {
  'Missing Males': { color: '#5E86B0', label: 'Missing · men', type: 'Missing', gender: 'Male' },
  'Unidentified Males': { color: '#6B6DA6', label: 'Unidentified · men', type: 'Unidentified', gender: 'Male' },
  'Missing Females': { color: '#C4805A', label: 'Missing · women', type: 'Missing', gender: 'Female' },
  'Unidentified Females': { color: '#A86C86', label: 'Unidentified · women', type: 'Unidentified', gender: 'Female' },
};

// Non-color category cue (WCAG 1.4.1): shape encodes gender (circle = man,
// diamond = woman); fill encodes type (solid = missing, outline = unidentified).
function innerMark(gender, type) {
  const filled = type === 'Missing';
  const s = filled ? 'fill="#ffffff" fill-opacity="0.95"' : 'fill="none" stroke="#ffffff" stroke-width="1.8"';
  const cx = 12;
  const cy = 11.2;
  if (gender === 'Female') {
    const r = filled ? 4 : 3.6;
    return `<path d="M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z" ${s}/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${filled ? 4 : 3.4}" ${s}/>`;
}

// Matching glyph for the legend, in the category color.
export function markGlyph(category) {
  const c = CATEGORY_STYLES[category] || {};
  const filled = c.type === 'Missing';
  const s = filled ? `fill="${c.color}"` : `fill="none" stroke="${c.color}" stroke-width="2.2"`;
  const shape =
    c.gender === 'Female'
      ? `<path d="M9 3.2 L14.8 9 L9 14.8 L3.2 9 Z" ${s}/>`
      : `<circle cx="9" cy="9" r="${filled ? 6 : 5}" ${s}/>`;
  return `<svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true" focusable="false">${shape}</svg>`;
}

const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

let map;
let cluster;
let baseLayer;
const markerById = new Map();

function pinIcon(color, gender, type) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="26" height="34" aria-hidden="true">
    <path d="M12 1C6.2 1 1.5 5.6 1.5 11.3c0 7.4 9.2 18.6 9.6 19.1a1.2 1.2 0 0 0 1.8 0c.4-.5 9.6-11.7 9.6-19.1C22.5 5.6 17.8 1 12 1z"
      fill="${color}" stroke="#ffffff" stroke-width="1.6"/>
    ${innerMark(gender, type)}
  </svg>`;
  return L.divIcon({
    className: 'pin-marker',
    html: svg,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
    popupAnchor: [0, -30],
  });
}

function clusterIcon(cluster) {
  const n = cluster.getChildCount();
  const size = n < 10 ? 34 : n < 50 ? 40 : 48;
  return L.divIcon({
    html: `<div class="cluster-bubble" style="width:${size}px;height:${size}px"><span>${n}</span></div>`,
    className: 'cluster-marker',
    iconSize: [size, size],
  });
}

// markercluster doesn't make cluster bubbles keyboard-operable — add it so
// keyboard users can expand clusters (the case list is the primary a11y path).
function addClusterKeyboard() {
  for (const el of document.querySelectorAll('.leaflet-marker-icon.cluster-marker')) {
    if (el.dataset.kb) continue;
    el.dataset.kb = '1';
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    const n = el.querySelector('.cluster-bubble span')?.textContent || '';
    el.setAttribute('aria-label', `Cluster of ${n} cases — activate to zoom in`);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  }
}

export function initMap(theme = 'light') {
  map = L.map('map', {
    center: [39.5, -111.7],
    zoom: 6,
    zoomControl: true,
    scrollWheelZoom: true,
    worldCopyJump: true,
  });
  baseLayer = L.tileLayer(TILE_URLS[theme] || TILE_URLS.light, {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: clusterIcon,
  });
  map.addLayer(cluster);
  cluster.on('animationend', addClusterKeyboard);
  return map;
}

export function renderMarkers(people, onClick) {
  cluster.clearLayers();
  markerById.clear();
  const markers = [];
  for (const p of people) {
    const style = CATEGORY_STYLES[p.category] || CATEGORY_STYLES['Missing Males'];
    const marker = L.marker([p.lat, p.lng], {
      icon: pinIcon(style.color, style.gender, style.type),
      keyboard: true,
      title: `${p.name}${p.year ? `, ${p.year}` : ''}`,
      alt: `${p.name}${p.year ? `, ${p.year}` : ''} — ${style.label}`,
    });
    marker.on('click', () => onClick(p));
    marker.on('keypress', (e) => {
      if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') onClick(p);
    });
    markerById.set(p.id, marker);
    markers.push(marker);
  }
  cluster.addLayers(markers);
  setTimeout(addClusterKeyboard, 0);
}

// Pan/zoom to a person even if they're inside a collapsed cluster.
export function focusPerson(id) {
  const marker = markerById.get(id);
  if (!marker) return;
  cluster.zoomToShowLayer(marker, () => {
    map.panTo(marker.getLatLng(), { animate: true });
  });
}

export function getMap() {
  return map;
}

export function setMapTheme(theme) {
  if (baseLayer) baseLayer.setUrl(TILE_URLS[theme] || TILE_URLS.light);
}
