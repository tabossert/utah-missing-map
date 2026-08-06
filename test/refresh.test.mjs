import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { refreshLive } from '../src/refresh.js';

globalThis.DOMParser = DOMParser;

const OLD = 'https://mymaps.usercontent.google.com/hostedimage/m/*/TOK-OLD?fife=s16383';
const NEW = 'https://mymaps.usercontent.google.com/hostedimage/m/*/TOK-NEW?fife=s16383';

const kml = (urls, narrative = 'Found in Utah.') => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Unidentified Females</name>
<Placemark><name>Jane Doe, 2001</name><styleUrl>#icon-A52714</styleUrl>
<description>${narrative}</description>
<ExtendedData><Data name="gx_media_links"><value>${urls.join(' ')}</value></Data></ExtendedData>
<Point><coordinates>-111.9,40.7,0</coordinates></Point>
</Placemark></Folder></Document></kml>`;

// The deployed snapshot: one self-hosted photo, rotating src dropped by the build.
const snapshot = () => [
  {
    id: 'jane-doe-2001',
    name: 'Jane Doe',
    year: 2001,
    photos: [{ src: null, local: 'images/jane-doe-2001/0.jpg' }],
    narrative: 'Found in Utah.',
    extras: [{ kind: 'note', body: 'kept' }],
  },
];

const live = async (urls, current, narrative) => {
  globalThis.fetch = async () => new Response(kml(urls, narrative), { status: 200 });
  const [person] = await refreshLive(current);
  return person;
};

// What scorecard.js photoSources() resolves each photo to.
const shown = (p) => p.photos.map((ph) => ph.local || ph.src);

test('an unchanged photo set keeps its self-hosted files', async () => {
  const p = await live([OLD], snapshot());
  assert.deepEqual(shown(p), ['images/jane-doe-2001/0.jpg']);
});

test('an appended photo hotlinks rather than reusing snapshot positions', async () => {
  const p = await live([OLD, NEW], snapshot());
  assert.equal(p.photos.length, 2);
  for (const src of shown(p)) assert.match(src, /^https:\/\/mymaps\.usercontent\.google\.com\//);
});

test('a reordered photo set never shows a snapshot file under the wrong photo', async () => {
  const p = await live([NEW, OLD], snapshot());
  assert.deepEqual(
    shown(p).map((s) => s.match(/TOK-\w+/)[0]),
    ['TOK-NEW', 'TOK-OLD'],
  );
});

test('a brand-new person hotlinks every photo', async () => {
  const p = await live([NEW], []);
  assert.match(shown(p)[0], /TOK-NEW/);
});

test('photos are sized down and admin extras survive the merge', async () => {
  const p = await live([NEW], []);
  assert.match(p.photos[0].src, /fife=s1400$/);
  const known = await live([OLD], snapshot());
  assert.deepEqual(known.extras, [{ kind: 'note', body: 'kept' }]);
});

test('narrative text always comes from the live map', async () => {
  const p = await live([OLD], snapshot(), 'Found near Provo.');
  assert.equal(p.narrative, 'Found near Provo.');
});
