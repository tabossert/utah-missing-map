// Admin panel: magic-link auth → admin check → per-marker extras editor.
import { getSupabase, isConfigured } from './supabase.js';
import { CONFIG } from './config.js';
import { CATEGORY_STYLES } from './map.js';
import { currentTheme, initTheme, wireThemeToggle } from './theme.js';
import {
  RANGES,
  avgVisitSeconds,
  bounceRate,
  bubbleRadius,
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
  $('messages-refresh').addEventListener('click', loadMessages);
  $('recipient-form').addEventListener('submit', onAddRecipient);
  wireTabs();
  updateFormFields();
  renderPicker();
  loadMessages(); // so the unread badge is right before the tab is ever opened
}

/* ---- messages ----------------------------------------------------------- */
// contact_messages has no anon policy at all — these rows are only readable
// because this session's JWT passes the `admins` allowlist check in RLS.

async function loadMessages() {
  const msg = $('messages-msg');
  msg.textContent = 'Loading…';
  const { data, error } = await sb
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    msg.textContent =
      error.code === '42P01'
        ? 'The contact_messages table isn’t installed yet — re-run supabase/schema.sql (see the README).'
        : `Couldn’t load messages: ${error.message}`;
    $('messages-list').replaceChildren();
    return;
  }
  msg.textContent = '';
  renderMessages(data || []);
}

function renderMessages(rows) {
  const unread = rows.filter((r) => !r.read_at).length;
  const badge = $('messages-badge');
  badge.hidden = !unread;
  badge.textContent = String(unread);

  if (!rows.length) {
    $('messages-list').replaceChildren(
      Object.assign(document.createElement('li'), { className: 'bar-empty', textContent: 'No messages yet.' }),
    );
    return;
  }
  $('messages-list').replaceChildren(...rows.map(messageItem));
}

function messageItem(row) {
  const li = document.createElement('li');
  li.className = row.read_at ? 'message-row' : 'message-row unread';

  const head = document.createElement('div');
  head.className = 'message-head';
  const who = document.createElement('strong');
  who.textContent = [row.first_name, row.last_name].filter(Boolean).join(' ') || '(no name)';
  const when = document.createElement('span');
  when.className = 'message-when';
  when.textContent = new Date(row.created_at).toLocaleString();
  head.append(who, when);

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  // The scheme is fixed, so these can't become javascript: links; the address
  // itself already passed the edge function's format check.
  const mail = document.createElement('a');
  mail.href = `mailto:${row.email}`;
  mail.textContent = row.email;
  meta.append(mail);
  if (row.phone) {
    const tel = document.createElement('a');
    tel.href = `tel:${String(row.phone).replace(/[^\d+]/g, '')}`;
    tel.textContent = row.phone; // as typed; the href is the dialable form
    meta.append(tel);
  }
  if (row.marker_name) {
    const about = document.createElement('span');
    about.className = 'kind-tag';
    about.textContent = row.marker_name;
    meta.append(about);
  }
  if (!row.may_contact) {
    const no = document.createElement('span');
    no.className = 'no-contact';
    no.textContent = 'Asked not to be contacted';
    meta.append(no);
  }

  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = row.message;

  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const read = document.createElement('button');
  read.type = 'button';
  read.textContent = row.read_at ? 'Mark unread' : 'Mark read';
  read.addEventListener('click', () => setRead(row, !row.read_at));
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = 'Delete';
  del.addEventListener('click', () => deleteMessage(row));
  actions.append(read, del);

  li.append(head, meta, body, actions);
  return li;
}

async function setRead(row, read) {
  const { error } = await sb
    .from('contact_messages')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', row.id);
  if (error) $('messages-msg').textContent = `Couldn’t update: ${error.message}`;
  await loadMessages();
}

async function deleteMessage(row) {
  if (!confirm('Delete this message? This cannot be undone.')) return;
  const { error } = await sb.from('contact_messages').delete().eq('id', row.id);
  if (error) $('messages-msg').textContent = `Couldn’t delete: ${error.message}`;
  await loadMessages();
}

/* ---- notification recipients -------------------------------------------- */
// The edge function reads this table with the service-role key, so editing it
// here changes who gets emailed without redeploying the function.

async function loadRecipients() {
  const { data, error } = await sb.from('contact_recipients').select('*').order('email');
  if (error) {
    $('recipients-msg').textContent = `Couldn’t load recipients: ${error.message}`;
    return;
  }
  $('recipients-msg').textContent = '';
  const list = $('recipients-list');
  if (!data.length) {
    list.replaceChildren(
      Object.assign(document.createElement('li'), {
        className: 'bar-empty',
        textContent: 'Nobody is being notified — new messages will only appear here.',
      }),
    );
    return;
  }
  list.replaceChildren(...data.map(recipientItem));
}

function recipientItem(row) {
  const li = document.createElement('li');
  const email = document.createElement('span');
  email.className = 'grow';
  email.textContent = row.email;
  if (!row.active) email.classList.add('inactive');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = row.active ? 'Pause' : 'Resume';
  toggle.addEventListener('click', () => setRecipientActive(row, !row.active));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'del';
  del.textContent = 'Remove';
  del.addEventListener('click', () => removeRecipient(row));

  li.append(email, toggle, del);
  return li;
}

async function onAddRecipient(e) {
  e.preventDefault();
  const input = $('recipient-email');
  const email = input.value.trim().toLowerCase();
  if (!email) return;
  // Re-adding a paused address should switch it back on, not fail on the key.
  const { error } = await sb
    .from('contact_recipients')
    .upsert({ email, active: true }, { onConflict: 'email' });
  $('recipients-msg').textContent = error ? `Couldn’t add: ${error.message}` : '';
  if (!error) input.value = '';
  await loadRecipients();
}

async function setRecipientActive(row, active) {
  const { error } = await sb.from('contact_recipients').update({ active }).eq('email', row.email);
  if (error) $('recipients-msg').textContent = `Couldn’t update: ${error.message}`;
  await loadRecipients();
}

async function removeRecipient(row) {
  if (!confirm(`Stop emailing ${row.email}?`)) return;
  const { error } = await sb.from('contact_recipients').delete().eq('email', row.email);
  if (error) $('recipients-msg').textContent = `Couldn’t remove: ${error.message}`;
  await loadRecipients();
}

function wireTabs() {
  const tabs = [
    ['tab-cases', 'panel-cases'],
    ['tab-traffic', 'panel-traffic'],
    ['tab-messages', 'panel-messages'],
  ];
  tabs.forEach(([tabId, panelId]) =>
    $(tabId).addEventListener('click', () => {
      tabs.forEach(([t, p]) => {
        $(t).setAttribute('aria-selected', String(t === tabId));
        $(p).hidden = p !== panelId;
      });
      if (panelId === 'panel-traffic') openTraffic();
      if (panelId === 'panel-messages') {
        loadMessages();
        loadRecipients();
      }
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
  // <svg> is not an HTMLElement, so `.hidden` would set a dead expando and
  // leave an empty 56px strip behind — toggle the real attribute instead.
  $('traffic-spark').toggleAttribute('hidden', !path);
  $('traffic-spark-path').setAttribute('d', path);

  renderMap(d.cities || []);
  renderBars('bd-pages', topRows(d.pages));
  renderBars('bd-referrers', topRows(d.referrers, 8, referrerLabel));
  renderBars('bd-countries', topRows(d.countries));
  renderBars('bd-devices', topRows(d.devices));
}

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
let visitorMap = null;
let bubbles = null;

// One bubble per city, never per view — a point is always a group. The
// coordinates are the geo provider's city centroid, not a visitor's position.
function renderMap(cities) {
  const located = cities.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  $('traffic-map').hidden = !located.length;
  $('traffic-map-empty').hidden = Boolean(located.length);
  if (!located.length) return;

  if (!visitorMap) {
    // Set a view up front: a Leaflet map without one renders nothing at all,
    // so a failed fitBounds below would otherwise leave a blank container.
    visitorMap = L.map('traffic-map', {
      zoomControl: true,
      scrollWheelZoom: false,
      maxBounds: [[-85, -180], [85, 180]], // one world; bubbles can't land on a copy
      maxBoundsViscosity: 1,
      minZoom: 1,
    }).setView([25, -30], 2);
    L.tileLayer(TILES[currentTheme()] || TILES.light, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      noWrap: true, // otherwise the globe tiles sideways at low zoom
      maxZoom: 12, // city centroids; zooming past this implies precision we don't have
    }).addTo(visitorMap);
    bubbles = L.layerGroup().addTo(visitorMap);
  }
  bubbles.clearLayers();

  const max = Math.max(...located.map((c) => c.visitors || 0));
  located.forEach((c) => {
    const where = [c.city, c.country].filter(Boolean).join(', ') || 'Unknown';
    L.circleMarker([c.lat, c.lon], {
      radius: bubbleRadius(c.visitors, max),
      color: '#4A6D6F',
      weight: 1.5,
      fillColor: '#4A6D6F',
      fillOpacity: 0.35,
    })
      .bindTooltip(`${where} — ${formatCount(c.visitors)} visitor${c.visitors === 1 ? '' : 's'}`)
      .addTo(bubbles);
  });

  // Leaflet measures 0x0 while the tab is hidden, so size and fit after paint.
  // Pad in pixels, not degrees — a ratio pad pushes worldwide bounds past
  // ±180° longitude, which makes fitBounds a silent no-op and blanks the map.
  requestAnimationFrame(() => {
    visitorMap.invalidateSize();
    const bounds = L.latLngBounds(located.map((c) => [c.lat, c.lon]));
    if (bounds.isValid()) visitorMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
  });
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
