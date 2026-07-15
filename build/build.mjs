// Build the self-hosted snapshot: fetch the live Google My Map KML, parse it,
// download every photo (sized down) into /images/<id>/, and write /data/data.json.
// Idempotent: photos already on disk are skipped, so the hourly rebuild only
// pulls genuinely new images.
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
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
function sizedUrl(url) {
  return url.replace(/fife=s\d+/, 'fife=s1400');
}

async function fetchWithRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

function existingLocal(id, index) {
  const dir = join(IMAGES_DIR, id);
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f.startsWith(`${index}.`));
  return hit ? `images/${id}/${hit}` : null;
}

async function downloadPhoto(id, index, url) {
  const cached = existingLocal(id, index);
  if (cached) return cached;
  try {
    const res = await fetchWithRetry(sizedUrl(url));
    const raw = Buffer.from(await res.arrayBuffer());
    // Re-encode to a sized JPEG so the self-hosted repo stays lean.
    const jpeg = await sharp(raw)
      .rotate()
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    const dir = join(IMAGES_DIR, id);
    mkdirSync(dir, { recursive: true });
    const rel = `images/${id}/${index}.jpg`;
    writeFileSync(join(ROOT, rel), jpeg);
    return rel;
  } catch (err) {
    console.warn(`  ! photo ${id}#${index} failed: ${err.message} (will hotlink at runtime)`);
    return null; // client falls back to the google src
  }
}

// Simple concurrency pool over an array of async thunks.
async function pool(tasks, size) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

async function main() {
  console.log(`Fetching KML: ${KML_URL}`);
  const kml = await (await fetchWithRetry(KML_URL)).text();
  const people = parseKml(kml, DOMParser);
  console.log(`Parsed ${people.length} records.`);

  // Normalize stored src to the sized URL, then download every photo.
  const jobs = [];
  for (const p of people) {
    p.photos.forEach((photo, i) => {
      photo.src = sizedUrl(photo.src);
      jobs.push(async () => {
        photo.local = await downloadPhoto(p.id, i, photo.src);
      });
    });
  }
  console.log(`Downloading ${jobs.length} photos (concurrency ${CONCURRENCY})...`);
  await pool(jobs, CONCURRENCY);

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
