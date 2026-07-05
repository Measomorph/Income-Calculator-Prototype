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

/**
 * Upgrades a v3 payload (single shared account, monthly-only entries,
 * one global shared percentage) to the v4 shape: entries carry
 * frequency/category, accounts is an array with the shared pot as the
 * primary account, and the split settings live under `split`.
 */
/**
 * v5 adds: addedAt on entries (so one-offs can age out), a scenarios array,
 * and signed direct-entry amounts on accounts (withdrawals are negative).
 */
export function migrateToV5(state) {
  const v4 = migrateToV4(state);
  if (!v4) return null;
  if (v4.version === 5) return v4;

  const stampEntries = (entries) => (entries || []).map((entry) => ({
    ...entry,
    addedAt: entry.addedAt || new Date().toISOString(),
  }));

  return {
    ...v4,
    version: 5,
    people: (v4.people || []).map((person) => ({ ...person, entries: stampEntries(person.entries) })),
    scenarios: Array.isArray(v4.scenarios) ? v4.scenarios : [],
  };
}

export function migrateToV4(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.version === 4 || state.version === 5) return state;

  const people = (Array.isArray(state.people) ? state.people : []).map((person) => ({
    id: person.id,
    name: person.name,
    goals: Array.isArray(person.goals) ? person.goals : [],
    entries: (Array.isArray(person.entries) ? person.entries : []).map((entry) => ({
      ...entry,
      frequency: entry.frequency || 'monthly',
      category: entry.category || 'Other',
    })),
  }));

  const shared = state.shared || {};
  const accounts = Array.isArray(state.accounts) ? state.accounts : [
    {
      id: 'shared',
      name: 'Shared Account',
      primary: true,
      startingBalance: Number(shared.startingBalance) || 0,
      directEntries: Array.isArray(shared.directEntries) ? shared.directEntries : [],
      rules: [],
      goals: [],
    },
  ];

  return {
    version: 4,
    currencyCode: state.currencyCode || 'GBP',
    interval: state.interval || 'month',
    split: state.split || {
      strategy: 'equal-keeps',
      sharedPercentage: Number.isFinite(Number(state.sharedPercentage)) ? Number(state.sharedPercentage) : 35,
      customShares: {},
    },
    people,
    accounts,
    snapshots: Array.isArray(state.snapshots) ? state.snapshots : [],
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
      if (parsed && typeof parsed === 'object') return migrateToV5(parsed);
    } catch (error) {
      console.error('Failed to restore planner state', error);
    }
  }

  // Fall back to pre-rewrite data so nobody loses what the old app saved.
  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return null;
  try {
    return migrateToV5(convertLegacyState(JSON.parse(legacyRaw)));
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

/** Normalizes any supported backup shape (v2..v5, decrypted payloads) to v5. */
export function normalizeImportedState(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const migrated = parsed.currencySymbol ? convertLegacyState(parsed) : parsed;
  return migrateToV5(migrated);
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
        const migrated = parsed.currencySymbol ? convertLegacyState(parsed) : parsed;
        resolve(migrateToV5(migrated));
      } catch (error) {
        reject(new Error('File is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsText(file);
  });
}
