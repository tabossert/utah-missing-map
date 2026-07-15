// Light/dark theme: a no-flash head script sets data-theme before paint; this
// module handles the toggle + persistence. currentTheme() reflects the applied
// theme so the map can pick matching tiles.
const KEY = 'umm-theme';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
}

export function initTheme() {
  if (!document.documentElement.dataset.theme) {
    const saved = localStorage.getItem(KEY);
    apply(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }
  return currentTheme();
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode — ignore */
  }
  apply(next);
  return next;
}

// Wire the header toggle button; onChange(theme) fires after each switch.
export function wireThemeToggle(onChange) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const render = () => {
    const dark = currentTheme() === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  };
  render();
  btn.addEventListener('click', () => {
    const t = toggleTheme();
    render();
    if (onChange) onChange(t);
  });
}
