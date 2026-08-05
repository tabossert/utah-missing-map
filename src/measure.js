// Measure tool: click points to build a path, read per-leg and total distance,
// close the ring for area. Units auto-scale to the size of what's drawn.
import { distanceMeters, pathLengthMeters } from './geo.js';
import { pickDistanceUnit, formatDistance, formatLeg } from './units.js';

const L = globalThis.L;

const DEDUPE_PX = 10; // ignore a click landing this close to the last vertex

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

const RULER_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <rect x="1.5" y="6.5" width="17" height="7" rx="1.3" transform="rotate(-45 10 10)" />
  <path d="M6.6 6.2 L7.9 7.5 M8.9 8.5 L10.2 9.8 M11.2 10.8 L12.5 12.1" />
</svg>`;

export function initMeasure(m) {
  map = m;
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
  document.addEventListener('keydown', onKeydown);
}

export function isMeasuring() {
  return active;
}

function onMapClick(e) {
  if (active) addVertex(e.latlng);
}

export function addVertex(latlng) {
  if (!active) return;
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
      icon: L.divIcon({ className: 'measure-handle', iconSize: [14, 14] }),
    }).addTo(handleLayer);
    handle.on('dragstart', () => {
      justDragged = true;
    });
    // Only the geometry is rebuilt mid-drag — rebuilding handles here would
    // destroy the marker Leaflet is currently dragging.
    handle.on('drag', (e) => {
      verts[i] = e.target.getLatLng();
      refreshGeometry();
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
  redraw({ announce: true });
}

function refreshGeometry({ announce = false } = {}) {
  geomLayer.clearLayers();
  if (verts.length >= 2) {
    L.polyline(verts, { className: 'measure-casing', interactive: false }).addTo(geomLayer);
    L.polyline(verts, { className: 'measure-line', interactive: false }).addTo(geomLayer);
    const unit = pickDistanceUnit(pathLengthMeters(verts), system);
    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1];
      const b = verts[i];
      L.marker(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2), {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'measure-leg',
          iconSize: [0, 0],
          html: `<span>${formatLeg(distanceMeters(a, b), unit)}</span>`,
        }),
      }).addTo(geomLayer);
    }
  }
  renderCard(announce);
}

function renderCard(announce) {
  if (verts.length < 2) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }
  const total = pathLengthMeters(verts);
  const distance = formatDistance(total, pickDistanceUnit(total, system));
  card.replaceChildren(readoutRow('Total', distance));
  card.hidden = false;
  if (announce) live.textContent = `Total distance ${distance}.`;
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
}

// scorecard.js owns Escape for dialog -> lightbox -> case card; measure sits at
// the bottom of that stack and only acts when nothing above it is open.
function onKeydown(e) {
  if (e.key !== 'Escape' || !active) return;
  if (document.querySelector('dialog[open]')) return;
  if (document.body.classList.contains('panel-open')) return;
  setActive(false);
}
