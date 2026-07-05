const THEME_KEY = 'income-shared-planner-theme';

export function getStoredTheme() {
  return localStorage.getItem(THEME_KEY);
}

export function getPreferredTheme() {
  const stored = getStoredTheme();
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function initTheme(toggleButton) {
  let theme = getPreferredTheme();
  applyTheme(theme);
  updateToggleLabel(toggleButton, theme);

  toggleButton.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    updateToggleLabel(toggleButton, theme);
    localStorage.setItem(THEME_KEY, theme);
  });
}

function updateToggleLabel(button, theme) {
  button.textContent = theme === 'dark' ? '🌙 Dark' : '☀️ Light';
  button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
}
