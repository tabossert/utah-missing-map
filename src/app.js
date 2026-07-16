// App entry: load data, wire the map + filters + scorecard + refresh.
import { loadSnapshot, fetchExtras, attachExtras, deriveFacets } from './data.js';
import { initMap, renderMarkers, focusPerson, setMapTheme, CATEGORY_STYLES, markGlyph } from './map.js';
import { initTheme, wireThemeToggle } from './theme.js';
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
let filtered = [];
let lastUpdated = null;

const $ = (id) => document.getElementById(id);
const decadeFloor = (y) => Math.floor(y / 10) * 10;

async function main() {
  const theme = initTheme();
  initMap(theme);
  wireThemeToggle((t) => setMapTheme(t));
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
  filtered = applyFilters(people, state);
  renderMarkers(filtered, (p) => openCard(p));
  $('result-count').textContent = `Showing ${filtered.length.toLocaleString()} of ${people.length.toLocaleString()}`;
  if (!$('case-list').hidden) renderList();
}

// Keyboard + screen-reader accessible alternative to the map.
function renderList() {
  const ul = $('case-list-ul');
  ul.replaceChildren(
    ...filtered.map((p) => {
      const style = CATEGORY_STYLES[p.category] || {};
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'case-list-btn';
      btn.setAttribute('aria-label', `${p.name}${p.year ? `, ${p.year}` : ''} — ${style.label || p.category}`);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = style.color || '#888';
      const name = document.createElement('span');
      name.textContent = p.name;
      const yr = document.createElement('span');
      yr.className = 'yr';
      yr.textContent = p.year || '';
      btn.append(dot, name, yr);
      btn.addEventListener('click', () => {
        openCard(p);
        focusPerson(p.id);
      });
      li.append(btn);
      return li;
    }),
  );
}

function toggleList(force) {
  const panel = $('case-list');
  const open = force !== undefined ? force : panel.hidden;
  panel.hidden = !open;
  $('list-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    renderList();
    $('case-list-ul').querySelector('button')?.focus();
  } else {
    $('list-toggle').focus();
  }
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

  const ft = $('filters-toggle');
  if (ft) {
    ft.addEventListener('click', () => {
      const open = $('filters').classList.toggle('open');
      ft.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  $('list-toggle').addEventListener('click', () => toggleList());
  $('case-list-close').addEventListener('click', () => toggleList(false));
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
    ...Object.entries(CATEGORY_STYLES).map(([cat, s]) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const glyph = document.createElement('span');
      glyph.className = 'legend-glyph';
      glyph.innerHTML = markGlyph(cat);
      item.append(glyph, document.createTextNode(s.label));
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
    // Only rebuild the open card on a user-initiated refresh — never on the
    // hourly auto-refresh, which would destroy the reader's focus/scroll.
    if (!isAuto) {
      const openId = currentCardId();
      if (openId) {
        const p = people.find((x) => x.id === openId);
        if (p) openCard(p, { updateHash: false, focus: false });
      }
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
