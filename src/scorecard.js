// Scorecard side panel: full case detail, photo lightbox, admin extras, deep-link.
import { CATEGORY_STYLES } from './map.js';

const TIP_LINE = { label: '833-DPS-SAFE', tel: '8333777233', pretty: '833-DPS-SAFE (833-377-7233)' };

let panelEl;
let bodyEl;
let lightboxEl;
let lastFocus = null;
let currentId = null;
let onCloseCb = null;

// Small DOM builder — everything is text/attribute based (no innerHTML) to stay XSS-safe.
function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const safeHref = (url) => (/^https?:\/\//i.test(url || '') ? url : null);

export function initScorecard({ onClose } = {}) {
  panelEl = document.getElementById('scorecard');
  bodyEl = document.getElementById('scorecard-body');
  lightboxEl = document.getElementById('lightbox');
  onCloseCb = onClose;
  document.getElementById('scorecard-close').addEventListener('click', closeCard);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightboxEl.classList.contains('open')) closeLightbox();
      else if (panelEl.classList.contains('open')) closeCard();
    }
    if (e.key === 'Tab' && panelEl.classList.contains('open') && !lightboxEl.classList.contains('open')) {
      trapTab(e);
    }
  });
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl || e.target.classList.contains('lightbox-close')) closeLightbox();
  });
}

function trapTab(e) {
  const focusable = panelEl.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"]), video, img[tabindex]');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---- lightbox over the union of case photos + admin image extras ----
let galleryImages = [];
let galleryIndex = 0;

function openLightbox(images, index) {
  galleryImages = images;
  galleryIndex = index;
  renderLightbox();
  lightboxEl.classList.add('open');
  lightboxEl.setAttribute('aria-hidden', 'false');
}
function closeLightbox() {
  lightboxEl.classList.remove('open');
  lightboxEl.setAttribute('aria-hidden', 'true');
}
function renderLightbox() {
  const img = galleryImages[galleryIndex];
  const lb = [
    h('button', { class: 'lightbox-close', 'aria-label': 'Close image', text: '×' }),
    galleryImages.length > 1 &&
      h('button', {
        class: 'lightbox-nav prev',
        'aria-label': 'Previous',
        text: '‹',
        onclick: (e) => {
          e.stopPropagation();
          galleryIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
          renderLightbox();
        },
      }),
    h('img', { src: img.full, alt: img.alt || '' }),
    galleryImages.length > 1 &&
      h('button', {
        class: 'lightbox-nav next',
        'aria-label': 'Next',
        text: '›',
        onclick: (e) => {
          e.stopPropagation();
          galleryIndex = (galleryIndex + 1) % galleryImages.length;
          renderLightbox();
        },
      }),
  ];
  lightboxEl.replaceChildren(...lb.filter((c) => c != null && c !== false));
}

// photo object -> {thumb, full, alt}
function photoSources(photo, alt) {
  return { thumb: photo.local || photo.src, full: photo.local || photo.src, fallback: photo.src, alt };
}

function galleryFigure(imageObjs, i) {
  const img = h('img', {
    src: imageObjs[i].thumb,
    alt: imageObjs[i].alt || '',
    loading: 'lazy',
  });
  // If the self-hosted file 404s, fall back to the Google source.
  img.addEventListener('error', () => {
    if (imageObjs[i].fallback && img.src !== imageObjs[i].fallback) img.src = imageObjs[i].fallback;
  });
  return h(
    'button',
    { class: 'thumb', 'aria-label': 'View photo', onclick: () => openLightbox(imageObjs, i) },
    img,
  );
}

function renderExtras(extras, imageObjs) {
  if (!extras || !extras.length) return null;
  const items = [];
  for (const ex of extras) {
    if (ex.kind === 'note') {
      items.push(h('div', { class: 'extra-note' }, ex.title && h('h4', { text: ex.title }), h('p', { text: ex.body || '' })));
    } else if (ex.kind === 'link' && safeHref(ex.url)) {
      items.push(
        h('a', { class: 'extra-link', href: ex.url, target: '_blank', rel: 'noopener noreferrer' }, ex.title || ex.url, ' ↗'),
      );
    } else if (ex.kind === 'video' && safeHref(ex.url)) {
      items.push(h('figure', { class: 'extra-video' }, h('video', { src: ex.url, controls: '', preload: 'metadata' }), ex.title && h('figcaption', { text: ex.title })));
    } else if (ex.kind === 'file' && safeHref(ex.url)) {
      items.push(h('a', { class: 'extra-file', href: ex.url, target: '_blank', rel: 'noopener noreferrer', download: '' }, '📎 ', ex.title || 'Attachment'));
    }
    // image extras are folded into the gallery via imageObjs (built by caller)
  }
  return items.length ? h('section', { class: 'card-extras' }, h('h3', { text: 'Additional information' }), ...items) : null;
}

export function openCard(person, { updateHash = true, focus = true } = {}) {
  currentId = person.id;
  lastFocus = document.activeElement;

  const style = CATEGORY_STYLES[person.category] || {};
  // Build the combined image gallery (case photos + admin image extras).
  const imageObjs = [
    ...person.photos.map((ph) => photoSources(ph, `${person.name}${person.year ? `, ${person.year}` : ''}`)),
    ...(person.extras || [])
      .filter((e) => e.kind === 'image' && safeHref(e.url))
      .map((e) => ({ thumb: e.url, full: e.url, fallback: null, alt: e.title || person.name })),
  ];

  const links = (person.links || []).filter((l) => safeHref(l.url));

  const cards = [
    imageObjs.length
      ? h('div', { class: 'gallery' }, ...imageObjs.map((_, i) => galleryFigure(imageObjs, i)))
      : h('div', { class: 'gallery gallery-empty' }, h('span', { text: 'No photo available' })),

    h('div', { class: 'card-head' },
      h('span', { class: 'badge', style: `--dot:${style.color || '#888'}` }, h('span', { class: 'dot' }), style.label || person.category),
      h('h2', { class: 'card-name' }, person.name, person.year ? h('span', { class: 'card-year', text: ` · ${person.year}` }) : null),
    ),

    h('p', { class: 'card-location' }, h('span', { class: 'loc-label', text: person.locationLabel }), person.caseNumber ? h('span', { class: 'case', text: `Case #${person.caseNumber}` }) : null),

    person.narrative
      ? h('div', { class: 'card-narrative' }, ...person.narrative.split(/\n{2,}/).map((para) => h('p', { text: para })))
      : null,

    links.length
      ? h('section', { class: 'card-links' }, h('h3', { text: 'Case references' }), h('ul', {}, ...links.map((l) => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label, ' ↗')))))
      : null,

    renderExtras(person.extras, imageObjs),

    h('section', { class: 'card-tip' },
      h('p', { text: 'Have information about this case?' }),
      h('a', { class: 'tip-cta', href: `tel:${TIP_LINE.tel}` }, '☎ Call the Utah Cold Case Tip Line — ', TIP_LINE.pretty),
    ),

    h('div', { class: 'card-actions' },
      h('button', { class: 'share-btn', onclick: () => share(person) }, '⧉ Copy link to this case'),
    ),
  ];
  bodyEl.replaceChildren(...cards.filter((c) => c != null && c !== false));

  panelEl.classList.add('open');
  panelEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  bodyEl.scrollTop = 0;
  if (updateHash) history.replaceState(null, '', `#id=${encodeURIComponent(person.id)}`);
  if (focus) document.getElementById('scorecard-close').focus();
}

export function closeCard() {
  if (!panelEl.classList.contains('open')) return;
  panelEl.classList.remove('open');
  panelEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  currentId = null;
  if (location.hash.startsWith('#id=')) history.replaceState(null, '', location.pathname + location.search);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  if (onCloseCb) onCloseCb();
}

export function currentCardId() {
  return currentId;
}

async function share(person) {
  const url = `${location.origin}${location.pathname}#id=${encodeURIComponent(person.id)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast(url);
  }
}

let toastTimer;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
