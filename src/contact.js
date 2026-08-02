// Contact / tip form: a modal dialog posted to the `contact` edge function.
// Dormant when Supabase is unconfigured — the buttons stay hidden rather than
// offering a form that goes nowhere.
import { CONFIG } from './config.js';
import { isConfigured } from './supabase.js';

const endpoint = isConfigured() ? `${CONFIG.supabaseUrl}/functions/v1/contact` : null;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const FAILED = "Sorry — we couldn't send your message. Please check your connection and try again.";

let dialogEl;
let formEl;
let doneEl;
let openedAt = 0;
let sending = false;

export function contactAvailable() {
  return Boolean(endpoint);
}

// The envelope, built as SVG rather than set from a markup string, so callers
// that forbid innerHTML can still use it. Styling lives in .contact-icon.
export function contactIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'contact-icon');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const rect = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: 2, y: 4.5, width: 16, height: 11, rx: 1.8 })) {
    rect.setAttribute(k, String(v));
  }
  const flap = document.createElementNS(NS, 'path');
  flap.setAttribute('d', 'M2.8 5.6 L10 10.9 L17.2 5.6');
  svg.append(rect, flap);
  return svg;
}

// Mirrors the edge function's checks so the sender is corrected before a round
// trip; the server still re-validates, since this runs on the client.
export function validateContact({ first_name, email, message }) {
  if (!String(first_name || '').trim()) return 'Please enter your first name.';
  if (!EMAIL_RE.test(String(email || '').trim())) return 'Please enter a valid email address.';
  if (!String(message || '').trim()) return 'Please enter a message.';
  return null;
}

export function initContact() {
  dialogEl = document.getElementById('contact-dialog');
  formEl = document.getElementById('contact-form');
  doneEl = document.getElementById('contact-done');
  if (!dialogEl) return;

  if (!contactAvailable()) {
    for (const el of document.querySelectorAll('.contact-btn')) el.hidden = true;
    return;
  }

  document.getElementById('contact-btn')?.addEventListener('click', () => openContact());
  document.getElementById('contact-close').addEventListener('click', () => dismiss());
  document.getElementById('contact-done-close').addEventListener('click', () => dismiss());
  formEl.addEventListener('submit', onSubmit);
  // Click outside the card (the ::backdrop is the dialog's own box) dismisses.
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dismiss();
  });
  // Esc closes a <dialog> natively; block it mid-send so a half-sent message
  // can't be abandoned into an ambiguous state.
  dialogEl.addEventListener('cancel', (e) => {
    if (sending) e.preventDefault();
  });
}

function dismiss() {
  if (!sending) dialogEl.close();
}

export function openContact(about = null) {
  if (!dialogEl || !contactAvailable() || sending) return;
  formEl.reset();
  document.getElementById('contact-submit').disabled = false;
  openedAt = Date.now();
  formEl.hidden = false;
  doneEl.hidden = true;
  setMsg('');

  const aboutEl = document.getElementById('contact-about');
  aboutEl.hidden = !about;
  aboutEl.textContent = about ? `About: ${about.name}` : '';
  formEl.dataset.markerId = about?.id || '';
  formEl.dataset.markerName = about?.name || '';

  dialogEl.showModal();
  document.getElementById('contact-first').focus();
}

function setMsg(text, isError = false) {
  const el = document.getElementById('contact-msg');
  el.textContent = text;
  el.classList.toggle('error', Boolean(text) && isError);
}

const val = (id) => document.getElementById(id).value.trim();

async function onSubmit(e) {
  e.preventDefault();
  if (sending) return; // Enter-key repeat, or a double click that outran the disable
  const payload = {
    elapsed_ms: Date.now() - openedAt, // a form filled instantly wasn't filled by a person
    first_name: val('contact-first'),
    last_name: val('contact-last'),
    email: val('contact-email'),
    phone: val('contact-phone'),
    may_contact: formEl.querySelector('input[name="may_contact"]:checked')?.value !== 'no',
    message: val('contact-message'),
    website: val('contact-hp'), // honeypot
    marker_id: formEl.dataset.markerId || null,
    marker_name: formEl.dataset.markerName || null,
  };

  const problem = validateContact(payload);
  if (problem) {
    setMsg(problem, true);
    return;
  }

  const submit = document.getElementById('contact-submit');
  sending = true;
  submit.disabled = true;
  setMsg('Sending…');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: CONFIG.supabaseAnonKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      // `shown` marks a message written for the sender; anything else that
      // lands in the catch is a transport error like "Failed to fetch".
      throw Object.assign(new Error(error || FAILED), { shown: true });
    }
    formEl.hidden = true;
    doneEl.hidden = false;
    document.getElementById('contact-done-close').focus();
  } catch (err) {
    setMsg(err.shown ? err.message : FAILED, true);
    submit.disabled = false; // only a failure re-arms it; a sent form is gone
  } finally {
    sending = false;
  }
}
