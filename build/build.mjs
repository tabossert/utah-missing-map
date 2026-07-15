// Build the self-hosted snapshot: fetch the live Google My Map KML, parse it,
// download every photo (sized down) into /images/<id>/, and write /data/data.json.
//
// NOTE: Google's `hostedimage` URLs rotate a fresh token on every KML fetch, so
// the URL is NOT a stable cache key. Photos are named by (id, index) — the
// person + photo position, both stable across fetches — so unchanged photos are
// skipped and the hourly rebuild only pulls genuinely new ones. The rotating
// `src` is dropped from the snapshot for self-hosted photos (kept only as a
// last-resort fallback when a download failed), which also keeps data.json
// byte-stable across runs → an unchanged rebuild produces no git diff.
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { DOMParser } from '@xmldom/xmldom';
import { parseKml } from '../src/kml-parser.js';

const MID = '1oSzJorsXgSsXs6oWVNIJh3FgU2-xgWdU';
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MID}&forcekml=1`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR = join(ROOT, 'images');
const DATA_DIR = join(ROOT, 'data');
const CONCURRENCY = 8;
const MAX_DIM = 1000; // px — plenty for scorecard display
const JPEG_QUALITY = 80;

// Ask Google for a web-appropriate size instead of the s16383 originals.
const sizedUrl = (url) => url.replace(/fife=s\d+/, 'fife=s1400');
const localPath = (id, index) => `images/${id}/${index}.jpg`;

async function fetchWithRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

// Returns the self-hosted relative path, or null on failure (client falls back to src).
async function downloadPhoto(id, index, url) {
  const rel = localPath(id, index);
  if (existsSync(join(ROOT, rel))) return rel; // stable (id,index) → already have it
  try {
    const res = await fetchWithRetry(url);
    const raw = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(raw)
      .rotate()
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    mkdirSync(join(IMAGES_DIR, id), { recursive: true });
    writeFileSync(join(ROOT, rel), jpeg);
    return rel;
  } catch (err) {
    console.warn(`  ! photo ${id}#${index} failed: ${err.message} (will hotlink at runtime)`);
    return null;
  }
}

// Remove image files/dirs that no longer correspond to any current photo.
function pruneOrphans(people) {
  const keep = new Map();
  for (const p of people) {
    const set = keep.get(p.id) || new Set();
    for (const ph of p.photos) if (ph.local) set.add(ph.local.split('/').pop());
    keep.set(p.id, set);
  }
  if (!existsSync(IMAGES_DIR)) return;
  for (const dir of readdirSync(IMAGES_DIR)) {
    const abs = join(IMAGES_DIR, dir);
    if (!keep.has(dir)) {
      rmSync(abs, { recursive: true, force: true });
      continue;
    }
    const wanted = keep.get(dir);
    for (const f of readdirSync(abs)) if (!wanted.has(f)) rmSync(join(abs, f), { force: true });
  }
}

async function pool(tasks, size) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    }),
  );
}

function existingPeopleJson() {
  try {
    return JSON.stringify(JSON.parse(readFileSync(join(DATA_DIR, 'data.json'), 'utf-8')).people);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching KML: ${KML_URL}`);
  const kml = await (await fetchWithRetry(KML_URL)).text();
  const people = parseKml(kml, DOMParser);
  console.log(`Parsed ${people.length} records.`);

  const jobs = [];
  for (const p of people) {
    p.photos.forEach((photo, i) => {
      const url = sizedUrl(photo.src);
      jobs.push(async () => {
        photo.local = await downloadPhoto(p.id, i, url);
        // Drop the rotating URL for self-hosted photos; keep it only as a
        // runtime fallback when the download failed.
        photo.src = photo.local ? null : url;
      });
    });
  }
  console.log(`Downloading ${jobs.length} photos (concurrency ${CONCURRENCY})...`);
  await pool(jobs, CONCURRENCY);
  pruneOrphans(people);

  // Only rewrite data.json when the parsed content actually changed.
  if (JSON.stringify(people) === existingPeopleJson()) {
    console.log('No content changes; data.json left as-is.');
    return;
  }
  const withLocal = people.reduce((n, p) => n + p.photos.filter((ph) => ph.local).length, 0);
  mkdirSync(DATA_DIR, { recursive: true });
  const out = { generatedAt: new Date().toISOString(), count: people.length, source: KML_URL, people };
  writeFileSync(join(DATA_DIR, 'data.json'), JSON.stringify(out, null, 2));
  console.log(`Wrote data/data.json (${people.length} people, ${withLocal}/${jobs.length} photos self-hosted).`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
