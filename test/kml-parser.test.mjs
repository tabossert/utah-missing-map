import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseKml, slugify, extractYear, cleanName } from '../src/kml-parser.js';

const kml = readFileSync(fileURLToPath(new URL('./fixtures/sample.kml', import.meta.url)), 'utf-8');
const people = parseKml(kml, DOMParser);
const byName = (n) => people.find((p) => p.name === n);

test('parses every placemark', () => {
  assert.equal(people.length, 4);
});

test('category -> type/gender/locationLabel mapping', () => {
  const lester = byName('Lester McAllister');
  assert.equal(lester.category, 'Missing Males');
  assert.equal(lester.type, 'Missing');
  assert.equal(lester.gender, 'Male');
  assert.equal(lester.locationLabel, 'Last known location');

  const doe = people.find((p) => p.type === 'Unidentified');
  assert.equal(doe.category, 'Unidentified Males');
  assert.equal(doe.gender, 'Male');
  assert.equal(doe.locationLabel, 'Location found');

  const frances = byName('Frances Shurtleff Sessions');
  assert.equal(frances.gender, 'Female');
  assert.equal(frances.type, 'Missing');
});

test('year parsed from trailing and leading positions', () => {
  assert.equal(byName('Lester McAllister').year, 1918);
  assert.equal(byName('Everett Ruess').year, 1934);
  assert.equal(byName('Frances Shurtleff Sessions').year, 1946);
  assert.equal(people.find((p) => p.type === 'Unidentified').year, 1912); // "1912 John Doe"
});

test('display name is cleaned of the year token', () => {
  assert.equal(byName('John Doe').name, 'John Doe'); // leading "1912 " stripped
  assert.ok(byName('Lester McAllister')); // trailing ", 1918" stripped
});

test('coordinates use KML lng,lat order', () => {
  const lester = byName('Lester McAllister');
  assert.ok(Math.abs(lester.lat - 40.7457045) < 1e-6);
  assert.ok(Math.abs(lester.lng - -111.8739202) < 1e-6);
  // Utah bounds sanity: lat ~37-42, lng ~-114..-109
  for (const p of people) {
    assert.ok(p.lat > 36 && p.lat < 42.5, `lat ${p.lat}`);
    assert.ok(p.lng > -114.5 && p.lng < -108.5, `lng ${p.lng}`);
  }
});

test('photos extracted from gx_media_links, deduped, google src', () => {
  const lester = byName('Lester McAllister');
  assert.ok(lester.photos.length >= 1);
  assert.ok(lester.photos.every((ph) => ph.src.startsWith('https://') && ph.local === null));
  const urls = lester.photos.map((p) => p.src);
  assert.equal(new Set(urls).size, urls.length, 'no duplicate photo urls');
});

test('narrative strips images and hotline boilerplate', () => {
  const lester = byName('Lester McAllister');
  assert.ok(!/<img/i.test(lester.narrative));
  assert.ok(!/833-DPS-SAFE/i.test(lester.narrative));
  assert.ok(!/No Case #/i.test(lester.narrative));
  assert.ok(/Liberty Park/i.test(lester.narrative), 'keeps the story text');
});

test('case number detected across formats; null for "No Case #"', () => {
  assert.equal(byName('Everett Ruess').caseNumber, '0042753');
  assert.equal(byName('Frances Shurtleff Sessions').caseNumber, '22G14442');
  assert.equal(byName('Lester McAllister').caseNumber, null);
  assert.equal(byName('John Doe').caseNumber, null);
});

test('plain-text URLs become labeled links; NamUs not read as a case number', () => {
  const everett = byName('Everett Ruess');
  const namus = everett.links.find((l) => /namus\.gov/.test(l.url));
  assert.ok(namus, 'NamUs link captured');
  assert.equal(namus.label, 'Namus'); // from "Namus: <url>" prefix
  // The "Case#/53417" inside the NamUs URL must not be read as the case number.
  assert.equal(everett.caseNumber, '0042753');
  assert.ok(everett.links.some((l) => /doenetwork\.org/.test(l.url)));
  assert.ok(everett.links.every((l) => !l.url.includes('mymaps.usercontent')));
});

test('tip hotline surfaced separately', () => {
  assert.equal(byName('Lester McAllister').tipHotline, '833-DPS-SAFE (833-377-7233)');
});

test('ids are unique and stable slugs', () => {
  const ids = people.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  assert.equal(byName('Lester McAllister').id, 'lester-mcallister-1918');
});

test('helpers: slugify handles diacritics/punctuation', () => {
  assert.equal(slugify('José "Pepe" Núñez'), 'jose-pepe-nunez');
  assert.equal(extractYear('1934 John Doe - Davis County'), 1934);
  assert.equal(cleanName('1934 John Doe - Davis County'), 'John Doe - Davis County');
});
