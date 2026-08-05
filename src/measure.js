// Measure tool: click points to build a path, read per-leg and total distance,
// close the ring for area. Units auto-scale to the size of what's drawn.
import { distanceMeters, pathLengthMeters, ringAreaM2, closeRing } from './geo.js';
import { pickDistanceUnit, formatDistance, formatLeg, formatArea, legLabelFits } from './units.js';

const L = globalThis.L;

const DEDUPE_PX = 10; // ignore a click landing this close to the last vertex
const UNITS_KEY = 'umm-units';

let map;
let active = false;
let toggleBtn;
let card;
let live;
let geomLayer;   // polylines + leg labels, rebuilt on every change
let handleLayer; // draggable vertex handles, rebuilt only when the list changes
let justDragged = false; // suppresses the synthetic click Leaflet fires after a drag
let verts = [];
let system = 'us';
let closed = false;

const RULER_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <rect x="1.5" y="6.5" width="17" height="7" rx="1.3" transform="rotate(-45 10 10)" />
  <path d="M6.6 6.2 L7.9 7.5 M8.9 8.5 L10.2 9.8 M11.2 10.8 L12.5 12.1" />
</svg>`;

export function initMeasure(m) {
  map = m;
  system = readUnits();
  geomLayer = L.layerGroup().addTo(map);
  handleLayer = L.layerGroup().addTo(map);
  card = document.getElementById('measure-card');
  live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  document.body.append(live);
  buildToggle();
  map.on('click', onMapClick);
  map.on('zoomend', () => refreshGeometry());
  // Capture phase: scorecard.js clears body.panel-open in its own bubble-phase
  // Escape handler, so bubbling here would read state it has already torn down.
  document.addEventListener('keydown', onKeydown, true);
}

export function isMeasuring() {
  return active;
}

function onMapClick(e) {
  if (active) addVertex(e.latlng);
}

export function addVertex(latlng) {
  if (!active || closed) return;
  const point = L.latLng(latlng);
  const last = verts[verts.length - 1];
  // Screen-space, not meters — a metric threshold would behave differently at
  // every zoom level.
  if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(point)) < DEDUPE_PX) {
    return;
  }
  verts.push(point);
  redraw({ announce: true });
}

// Handles are rebuilt only when the vertex list itself changes — never mid-drag.
function redraw(opts) {
  rebuildHandles();
  refreshGeometry(opts);
}

function rebuildHandles() {
  handleLayer.clearLayers();
  verts.forEach((pt, i) => {
    const handle = L.marker(pt, {
      draggable: true,
      keyboard: false,
      interactive: active, // inert once measure mode is off, so a pin underneath stays clickable
      icon: L.divIcon({ className: 'measure-handle', iconSize: [14, 14] }),
    }).addTo(handleLayer);
    handle.on('dragstart', () => {
      justDragged = true;
    });
    // Only the geometry is rebuilt mid-drag — rebuilding handles here would
    // destroy the marker Leaflet is currently dragging, and rebuilding the
    // card's control tree every frame would destroy its buttons too.
    handle.on('drag', (e) => {
      verts[i] = e.target.getLatLng();
      refreshGeometry({ valuesOnly: true });
    });
    handle.on('dragend', () => {
      refreshGeometry({ announce: true });
      setTimeout(() => {
        justDragged = false;
      }, 0);
    });
    handle.on('click', (e) => {
      L.DomEvent.stop(e);
      if (justDragged) return;
      removeVertex(i);
    });
  });
}

function removeVertex(i) {
  verts.splice(i, 1);
  if (verts.length < 3) closed = false;
  redraw({ announce: true });
}

function refreshGeometry({ announce = false, valuesOnly = false } = {}) {
  geomLayer.clearLayers();
  const line = closeRing(verts, closed);
  if (line.length >= 2) {
    L.polyline(line, { className: 'measure-casing', interactive: false }).addTo(geomLayer);
    L.polyline(line, { className: 'measure-line', interactive: false }).addTo(geomLayer);
    const unit = pickDistanceUnit(pathLengthMeters(line), system);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const text = formatLeg(distanceMeters(a, b), unit);
      const legPx = map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));
      if (!legLabelFits(legPx, text)) continue;
      L.marker(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'measure-leg', iconSize: [0, 0], html: `<span>${text}</span>` }),
      }).addTo(geomLayer);
    }
  }
  if (valuesOnly) updateCardValues();
  else renderCard(announce);
}

// Readout values only — no DOM rebuild, so a drag doesn't tear down the card's
// buttons (and any focus on one of them) on every mousemove frame.
function updateCardValues() {
  if (!card || verts.length < 2) return;
  const total = pathLengthMeters(closeRing(verts, closed));
  const distance = formatDistance(total, pickDistanceUnit(total, system));
  const [distanceEl, areaEl] = card.querySelectorAll('.measure-val');
  if (distanceEl) distanceEl.textContent = distance;
  if (closed && areaEl) areaEl.textContent = formatArea(ringAreaM2(verts), system);
}

function renderCard(announce) {
  if (!card) return;
  document.body.classList.toggle('has-measurement', verts.length >= 2);
  // Keep keyboard focus near where the user just acted — the control tree is
  // about to be rebuilt, or removed entirely if the measurement is now empty.
  const focused = card.contains(document.activeElement) ? document.activeElement.textContent : null;
  if (verts.length < 2) {
    card.hidden = true;
    card.replaceChildren();
    // State, not action — this branch is reached both by placing the first
    // point and by deleting back down to one.
    if (announce) live.textContent = verts.length ? 'One point placed.' : 'Measurement cleared.';
    // The card is gone — return focus to the control that owns this surface.
    if (focused) toggleBtn.focus();
    return;
  }
  const total = pathLengthMeters(closeRing(verts, closed));
  const distance = formatDistance(total, pickDistanceUnit(total, system));
  const area = closed ? formatArea(ringAreaM2(verts), system) : '';

  const rows = document.createElement('div');
  rows.append(readoutRow(closed ? 'Perimeter' : 'Total', distance));
  if (closed) rows.append(readoutRow('Area', area));

  const units = document.createElement('div');
  units.className = 'measure-units';
  units.setAttribute('role', 'group');
  units.setAttribute('aria-label', 'Measurement units');
  units.append(unitBtn('us', 'US'), unitBtn('metric', 'Metric'));

  const actions = document.createElement('div');
  actions.className = 'measure-actions';
  if (!closed && verts.length >= 3) actions.append(actionBtn('Close shape', closeShape));
  actions.append(actionBtn('Clear', clearAll));

  card.replaceChildren(rows, units, actions);
  card.hidden = false;
  if (focused) {
    const btns = [...card.querySelectorAll('button')];
    // The exact control may be gone (e.g. "Close shape" after closing) — land
    // on Clear, its always-present neighbour, rather than dropping to <body>.
    (btns.find((b) => b.textContent === focused) || btns.find((b) => b.textContent === 'Clear'))?.focus();
  }
  if (announce) {
    live.textContent = closed ? `Perimeter ${distance}. Area ${area}.` : `Total distance ${distance}.`;
  }
}

function actionBtn(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'measure-action';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function unitBtn(value, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'measure-unit';
  b.textContent = label;
  b.setAttribute('aria-pressed', system === value ? 'true' : 'false');
  b.addEventListener('click', () => setSystem(value));
  return b;
}

function closeShape() {
  if (verts.length < 3) return;
  closed = true;
  redraw({ announce: true });
}

// Clears the drawing but stays in measure mode, so the obvious next action —
// start another one — needs no extra click.
function clearAll() {
  verts = [];
  closed = false;
  redraw({ announce: true });
}

function readoutRow(label, value) {
  const row = document.createElement('p');
  row.className = 'measure-row';
  const k = document.createElement('span');
  k.className = 'measure-key';
  k.textContent = label;
  const v = document.createElement('strong');
  v.className = 'measure-val';
  v.textContent = value;
  row.append(k, v);
  return row;
}

function buildToggle() {
  const Ctl = L.Control.extend({
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-bar measure-toggle-wrap');
      toggleBtn = L.DomUtil.create('button', 'measure-toggle', wrap);
      toggleBtn.type = 'button';
      toggleBtn.innerHTML = RULER_SVG;
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      L.DomEvent.on(toggleBtn, 'click', (e) => {
        L.DomEvent.stop(e);
        setActive(!active);
      });
      return wrap;
    },
  });
  new Ctl({ position: 'topright' }).addTo(map);
  renderToggle();
}

function renderToggle() {
  const label = active ? 'Turn off the measure tool' : 'Measure distance on the map';
  toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  toggleBtn.setAttribute('aria-label', label);
  toggleBtn.setAttribute('title', label);
  toggleBtn.classList.toggle('is-active', active);
}

function setActive(next) {
  if (active === next) return;
  active = next;
  document.body.classList.toggle('measuring', active);
  // Otherwise a fast double-click drops two vertices and zooms the map.
  if (active) map.doubleClickZoom.disable();
  else map.doubleClickZoom.enable();
  renderToggle();
  rebuildHandles(); // apply the interactive/inert state immediately on toggle
}

function readUnits() {
  try {
    return localStorage.getItem(UNITS_KEY) === 'metric' ? 'metric' : 'us';
  } catch {
    return 'us'; // private mode — fall back to the default
  }
}

function setSystem(next) {
  if (system === next) return;
  system = next;
  try {
    localStorage.setItem(UNITS_KEY, next);
  } catch {
    /* private mode — ignore */
  }
  refreshGeometry({ announce: true });
}

// scorecard.js owns Escape for dialog -> lightbox -> case card; measure sits at
// the bottom of that stack and only acts when nothing above it is open.
function onKeydown(e) {
  if (e.key !== 'Escape' || !active) return;
  if (document.querySelector('dialog[open]')) return;
  if (document.body.classList.contains('panel-open')) return;
  setActive(false);
}
