const STORAGE_KEY = 'income-shared-planner-v3';
const LEGACY_STORAGE_KEY = 'income-shared-planner-v2';

const SYMBOL_TO_CODE = {
  '£': 'GBP',
  '$': 'USD',
  '€': 'EUR',
  '¥': 'JPY',
};

/**
 * Converts a v2 payload (currencySymbol, e.g. "£") into the v3 shape
 * (currencyCode, e.g. "GBP"). People/shared/snapshots carry over as-is.
 */
export function convertLegacyState(legacy) {
  if (!legacy || typeof legacy !== 'object') return null;
  const { currencySymbol, ...rest } = legacy;
  return {
    ...rest,
    currencyCode: SYMBOL_TO_CODE[(currencySymbol || '').trim()] || 'GBP',
  };
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to persist planner state', error);
  }
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      console.error('Failed to restore planner state', error);
    }
  }

  // Fall back to pre-rewrite data so nobody loses what the old app saved.
  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return null;
  try {
    return convertLegacyState(JSON.parse(legacyRaw));
  } catch (error) {
    console.error('Failed to migrate legacy planner state', error);
    return null;
  }
}

export function exportStateToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budget-planner-backup-${dateStamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function importStateFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') {
          reject(new Error('File does not contain a valid backup.'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error('File is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsText(file);
  });
}
