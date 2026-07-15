// App entry: load data, wire the map + filters + scorecard + refresh.
import { loadSnapshot, fetchExtras, attachExtras, deriveFacets } from './data.js';
import { initMap, renderMarkers, focusPerson, CATEGORY_STYLES } from './map.js';
import { applyFilters } from './filters.js';
import { initScorecard, openCard, closeCard, currentCardId } from './scorecard.js';
import { refreshLive, relativeTime } from './refresh.js';

const state = {
  q: '',
  types: new Set(['Missing', 'Unidentified']),
  genders: new Set(['Male', 'Female']),
  yearFrom: 1900,
  yearTo: 2100,
};

let people = [];
let lastUpdated = null;

const $ = (id) => document.getElementById(id);
const decadeFloor = (y) => Math.floor(y / 10) * 10;

async function main() {
  initMap();
  initScorecard();
  buildLegend();

  const snap = await loadSnapshot();
  people = snap.people;
  lastUpdated = snap.generatedAt;
  attachExtras(people, await fetchExtras());

  const { minYear, maxYear } = deriveFacets(people);
  state.yearFrom = decadeFloor(minYear);
  state.yearTo = maxYear;
  buildDecades(minYear, maxYear);

  wireControls();
  render();
  handleHash();
  window.addEventListener('hashchange', handleHash);

  updateStamp();
  setInterval(updateStamp, 30_000);
  setInterval(() => doRefresh(true), 3_600_000); // hourly auto-refresh
}

function render() {
  const filtered = applyFilters(people, state);
  renderMarkers(filtered, (p) => openCard(p));
  $('result-count').textContent = `Showing ${filtered.length.toLocaleString()} of ${people.length.toLocaleString()}`;
}

// ---- controls ----
function wireControls() {
  let t;
  $('search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value.trim();
      render();
    }, 150);
  });

  for (const btn of document.querySelectorAll('[data-type]')) {
    btn.addEventListener('click', () => toggleChip(btn, state.types, btn.dataset.type));
  }
  for (const btn of document.querySelectorAll('[data-gender]')) {
    btn.addEventListener('click', () => toggleChip(btn, state.genders, btn.dataset.gender));
  }

  $('decade-from').addEventListener('change', (e) => {
    state.yearFrom = Number(e.target.value);
    if (state.yearFrom > state.yearTo) {
      state.yearTo = state.yearFrom + 9;
      $('decade-to').value = String(state.yearFrom); // options are decade floors
    }
    render();
  });
  $('decade-to').addEventListener('change', (e) => {
    state.yearTo = Number(e.target.value) + 9;
    render();
  });

  $('refresh-btn').addEventListener('click', () => doRefresh(false));
}

function toggleChip(btn, set, value) {
  if (set.has(value)) {
    set.delete(value);
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  } else {
    set.add(value);
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
  }
  render();
}

function buildDecades(minYear, maxYear) {
  const from = $('decade-from');
  const to = $('decade-to');
  from.replaceChildren();
  to.replaceChildren();
  for (let d = decadeFloor(minYear); d <= decadeFloor(maxYear); d += 10) {
    from.append(new Option(`${d}s`, String(d)));
    to.append(new Option(`${d}s`, String(d)));
  }
  from.value = String(decadeFloor(minYear));
  to.value = String(decadeFloor(maxYear));
  state.yearFrom = decadeFloor(minYear);
  state.yearTo = decadeFloor(maxYear) + 9;
}

function buildLegend() {
  const legend = $('legend');
  legend.replaceChildren(
    ...Object.values(CATEGORY_STYLES).map((s) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = s.color;
      item.append(dot, document.createTextNode(s.label));
      return item;
    }),
  );
}

// ---- refresh ----
async function doRefresh(isAuto) {
  const btn = $('refresh-btn');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    const fresh = await refreshLive(people);
    people = fresh;
    // refreshLive already carried prior admin extras onto known people; only
    // overwrite when the fetch actually returned rows, so a transient Supabase
    // failure (empty map) doesn't wipe them.
    const extras = await fetchExtras();
    if (extras.size) attachExtras(people, extras);
    lastUpdated = new Date().toISOString();
    render();
    const openId = currentCardId();
    if (openId) {
      const p = people.find((x) => x.id === openId);
      if (p) openCard(p, { updateHash: false, focus: false });
    }
    updateStamp();
    if (!isAuto) flash('Up to date');
  } catch (err) {
    console.warn('refresh failed', err);
    if (!isAuto) flash("Couldn't refresh — showing saved data");
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

function updateStamp() {
  if (lastUpdated) $('freshness').textContent = `Updated ${relativeTime(lastUpdated)}`;
}

function flash(msg) {
  const el = $('freshness');
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => (el.textContent = prev), 2500);
}

// ---- deep linking ----
function handleHash() {
  const m = location.hash.match(/^#id=(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (id === currentCardId()) return;
    const p = people.find((x) => x.id === id);
    if (p) {
      openCard(p, { updateHash: false });
      focusPerson(p.id);
    }
  } else if (currentCardId()) {
    closeCard();
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById('result-count').textContent = 'Failed to load data.';
});
