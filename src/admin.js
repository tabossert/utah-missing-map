// Admin panel: magic-link auth → admin check → per-marker extras editor.
import { getSupabase, isConfigured } from './supabase.js';
import { CONFIG } from './config.js';
import { CATEGORY_STYLES } from './map.js';
import { initTheme, wireThemeToggle } from './theme.js';
import {
  RANGES,
  avgVisitSeconds,
  bounceRate,
  formatCount,
  formatDuration,
  referrerLabel,
  sparklinePath,
  topRows,
} from './traffic.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-unconfigured', 'view-login', 'view-denied', 'view-editor'];
const show = (id) => VIEWS.forEach((v) => ($(v).hidden = v !== id));

const sb = getSupabase();
let people = [];
let selected = null;
let editorReady = false;
let trafficRange = '30d';
let trafficWired = false;

init();

async function init() {
  initTheme();
  wireThemeToggle();
  if (!isConfigured() || !sb) {
    show('view-unconfigured');
    return;
  }
  $('signout-btn').addEventListener('click', () => sb.auth.signOut());
  $('login-form').addEventListener('submit', onLogin);
  const {
    data: { session },
  } = await sb.auth.getSession();
  await route(session);
  sb.auth.onAuthStateChange((_e, s) => route(s));
}

async function onLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim();
  $('login-msg').textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href.split('#')[0] },
  });
  $('login-msg').textContent = error ? `Error: ${error.message}` : 'Check your email for the sign-in link.';
}

async function route(session) {
  $('signout-btn').hidden = !session;
  if (!session) {
    $('admin-who').textContent = '';
    show('view-login');
    return;
  }
  const { data, error } = await sb
    .from('admins')
    .select('email')
    .eq('email', (session.user.email || '').toLowerCase())
    .maybeSingle();
  if (error || !data) {
    $('admin-who').textContent = session.user.email;
    show('view-denied');
    return;
  }
  $('admin-who').textContent = `Admin · ${session.user.email}`;
  show('view-editor');
  await initEditor();
}

async function initEditor() {
  if (editorReady) return;
  editorReady = true;
  people = (await fetch('data/data.json', { cache: 'no-cache' }).then((r) => r.json())).people;
  $('marker-search').addEventListener('input', renderPicker);
  $('extra-kind').addEventListener('change', updateFormFields);
  $('extra-form').addEventListener('submit', onAddExtra);
  wireTabs();
  updateFormFields();
  renderPicker();
}

function wireTabs() {
  const tabs = [
    ['tab-cases', 'panel-cases'],
    ['tab-traffic', 'panel-traffic'],
  ];
  tabs.forEach(([tabId, panelId]) =>
    $(tabId).addEventListener('click', () => {
      tabs.forEach(([t, p]) => {
        $(t).setAttribute('aria-selected', String(t === tabId));
        $(p).hidden = p !== panelId;
      });
      if (panelId === 'panel-traffic') openTraffic();
    }),
  );
}

function renderPicker() {
  const q = $('marker-search').value.trim().toLowerCase();
  const items = people
    .filter((p) => !q || `${p.name} ${p.year ?? ''}`.toLowerCase().includes(q))
    .slice(0, 200);
  $('marker-list').replaceChildren(
    ...items.map((p) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'marker-btn';
      if (selected === p.id) btn.setAttribute('aria-current', 'true');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = (CATEGORY_STYLES[p.category] || {}).color || '#888';
      const label = document.createElement('span');
      label.textContent = `${p.name}${p.year ? `, ${p.year}` : ''}`;
      btn.append(dot, label);
      btn.addEventListener('click', () => selectMarker(p));
      li.append(btn);
      return li;
    }),
  );
}

async function selectMarker(p) {
  selected = p.id;
  renderPicker();
  $('editor-empty').hidden = true;
  $('editor-detail').hidden = false;
  $('editor-title').textContent = `${p.name}${p.year ? `, ${p.year}` : ''}`;
  $('editor-view-link').href = `index.html#id=${encodeURIComponent(p.id)}`;
  await loadExtras(p.id);
}

async function loadExtras(markerId) {
  const list = $('extras-list');
  list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Loading…' }));
  const { data, error } = await sb.from('marker_extras').select('*').eq('marker_id', markerId).order('sort');
  if (error) {
    list.replaceChildren(Object.assign(document.createElement('li'), { textContent: `Error: ${error.message}` }));
    return;
  }
  if (!data.length) {
    list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'No additions yet.' }));
    return;
  }
  list.replaceChildren(
    ...data.map((row) => {
      const li = document.createElement('li');
      const tag = document.createElement('span');
      tag.className = 'kind-tag';
      tag.textContent = row.kind;
      const label = document.createElement('span');
      label.className = 'grow';
      label.textContent = row.title || row.body || row.url || '(untitled)';
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'Delete';
      del.addEventListener('click', () => deleteExtra(row));
      li.append(tag, label, del);
      return li;
    }),
  );
}

function updateFormFields() {
  const kind = $('extra-kind').value;
  $('field-body').hidden = kind !== 'note';
  $('field-url').hidden = kind !== 'link';
  $('field-file').hidden = !['image', 'video', 'file'].includes(kind);
  $('extra-file').setAttribute('accept', kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '');
}

async function onAddExtra(e) {
  e.preventDefault();
  const kind = $('extra-kind').value;
  const msg = $('extra-msg');
  const submit = $('extra-submit');
  msg.textContent = 'Saving…';
  submit.disabled = true;
  try {
    const row = { marker_id: selected, kind, title: $('extra-title').value.trim() || null, sort: Date.now() % 100000 };
    if (kind === 'note') {
      row.body = $('extra-body').value.trim();
      if (!row.body) throw new Error('Enter some text');
    } else if (kind === 'link') {
      const url = $('extra-url').value.trim();
      if (!/^https?:\/\//.test(url)) throw new Error('Enter a valid URL');
      row.url = url;
    } else {
      const file = $('extra-file').files[0];
      if (!file) throw new Error('Choose a file');
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${selected}/${crypto.randomUUID()}.${ext}`;
      $('upload-progress').textContent = 'Uploading…';
      const { error: upErr } = await sb.storage
        .from(CONFIG.mediaBucket)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw upErr;
      row.storage_path = path;
      row.url = sb.storage.from(CONFIG.mediaBucket).getPublicUrl(path).data.publicUrl;
      $('upload-progress').textContent = '';
    }
    const { error } = await sb.from('marker_extras').insert(row);
    if (error) throw error;
    msg.textContent = 'Added.';
    $('extra-title').value = '';
    $('extra-body').value = '';
    $('extra-url').value = '';
    $('extra-file').value = '';
    await loadExtras(selected);
  } catch (err) {
    msg.textContent = `Error: ${err.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function deleteExtra(row) {
  if (!confirm('Delete this addition?')) return;
  if (row.storage_path) await sb.storage.from(CONFIG.mediaBucket).remove([row.storage_path]);
  const { error } = await sb.from('marker_extras').delete().eq('id', row.id);
  if (error) alert(`Delete failed: ${error.message}`);
  await loadExtras(selected);
}

/* ---- traffic ------------------------------------------------------------ */
// Aggregates come from the traffic_stats RPC, which re-checks the admin
// allowlist in SQL — the raw page_views rows never reach the browser.

function openTraffic() {
  if (trafficWired) return;
  trafficWired = true;
  $('traffic-ranges').replaceChildren(
    ...RANGES.map((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'range-btn';
      btn.textContent = r.label;
      btn.setAttribute('aria-pressed', String(r.key === trafficRange));
      btn.addEventListener('click', () => {
        trafficRange = r.key;
        [...$('traffic-ranges').children].forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        loadTraffic();
      });
      return btn;
    }),
  );
  loadTraffic();
}

async function loadTraffic() {
  const msg = $('traffic-msg');
  msg.textContent = 'Loading…';
  const { data, error } = await sb.rpc('traffic_stats', {
    range_key: trafficRange,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (error || !data) {
    $('traffic-body').hidden = true;
    msg.textContent =
      error?.code === 'PGRST202'
        ? 'Traffic tables aren’t installed yet — run supabase/schema.sql (see the README).'
        : `Couldn’t load traffic: ${error?.message || 'no data returned'}`;
    return;
  }
  msg.textContent = '';
  $('traffic-body').hidden = false;
  renderTraffic(data);
}

function renderTraffic(d) {
  const s = d.stats || {};
  $('stat-visitors').textContent = formatCount(s.visitors);
  $('stat-pageviews').textContent = formatCount(s.pageviews);
  $('stat-visits').textContent = formatCount(s.visits);
  $('stat-duration').textContent = formatDuration(avgVisitSeconds(s));
  $('stat-bounce').textContent = bounceRate(s);
  $('stat-active').textContent = d.active == null ? '—' : formatCount(d.active);

  const path = sparklinePath(d.series);
  $('traffic-spark').hidden = !path;
  $('traffic-spark-path').setAttribute('d', path);

  renderBars('bd-pages', topRows(d.pages));
  renderBars('bd-referrers', topRows(d.referrers, 8, referrerLabel));
  renderBars('bd-countries', topRows(d.countries));
  renderBars('bd-devices', topRows(d.devices));
}

function renderBars(id, rows) {
  if (!rows.length) {
    $(id).replaceChildren(Object.assign(document.createElement('li'), { className: 'bar-empty', textContent: 'No data yet.' }));
    return;
  }
  $(id).replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.width = `${(r.share * 100).toFixed(1)}%`;
      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = r.label || '—';
      label.title = r.label;
      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = formatCount(r.value);
      li.append(bar, label, value);
      return li;
    }),
  );
}
