// Measure tool: click points to build a path, read per-leg and total distance,
// close the ring for area. Units auto-scale to the size of what's drawn.
const L = globalThis.L;

let map;
let active = false;
let toggleBtn;

const RULER_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <rect x="1.5" y="6.5" width="17" height="7" rx="1.3" transform="rotate(-45 10 10)" />
  <path d="M6.6 6.2 L7.9 7.5 M8.9 8.5 L10.2 9.8 M11.2 10.8 L12.5 12.1" />
</svg>`;

export function initMeasure(m) {
  map = m;
  buildToggle();
  document.addEventListener('keydown', onKeydown);
}

export function isMeasuring() {
  return active;
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
