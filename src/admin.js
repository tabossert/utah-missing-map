// Admin panel: magic-link auth → admin check → per-marker extras editor.
import { getSupabase, isConfigured } from './supabase.js';
import { CONFIG } from './config.js';
import { CATEGORY_STYLES } from './map.js';
import { initTheme, wireThemeToggle } from './theme.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-unconfigured', 'view-login', 'view-denied', 'view-editor'];
const show = (id) => VIEWS.forEach((v) => ($(v).hidden = v !== id));

const sb = getSupabase();
let people = [];
let selected = null;
let editorReady = false;

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
  updateFormFields();
  renderPicker();
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
