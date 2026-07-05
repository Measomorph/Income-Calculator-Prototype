import { FREQUENCIES } from './frequency.js';

const FREQUENCY_WORDS = {
  once: 'once', 'one-off': 'once', oneoff: 'once',
  daily: 'daily', day: 'daily',
  weekly: 'weekly', week: 'weekly', wk: 'weekly',
  fortnightly: 'fortnightly', biweekly: 'fortnightly',
  monthly: 'monthly', month: 'monthly', mo: 'monthly', pcm: 'monthly',
  quarterly: 'quarterly', quarter: 'quarterly',
  yearly: 'yearly', year: 'yearly', annually: 'yearly', annual: 'yearly', pa: 'yearly',
};

/**
 * Parses quick-add text like "Rent 950 monthly" or "Coffee 3.50" into
 * { description, amount, frequency }. Amount and frequency are optional
 * trailing tokens; anything before them is the description.
 */
export function parseQuickEntry(text) {
  const tokens = (text || '').trim().split(/\s+/);
  if (tokens.length < 2) return { description: (text || '').trim(), amount: null, frequency: null };

  let frequency = null;
  let amount = null;

  const lastToken = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z-]/g, '');
  if (FREQUENCY_WORDS[lastToken] && FREQUENCIES[FREQUENCY_WORDS[lastToken]]) {
    frequency = FREQUENCY_WORDS[lastToken];
    tokens.pop();
  }

  if (tokens.length >= 2) {
    const candidate = tokens[tokens.length - 1].replace(/[£$€¥,]/g, '');
    const value = parseFloat(candidate);
    if (Number.isFinite(value) && value > 0 && /^[\d.,£$€¥]+$/.test(tokens[tokens.length - 1])) {
      amount = value;
      tokens.pop();
    }
  }

  // A frequency word without an amount is just part of the description.
  if (amount === null && frequency !== null) {
    return { description: (text || '').trim(), amount: null, frequency: null };
  }

  return { description: tokens.join(' '), amount, frequency };
}

/**
 * Payee memory: remembers the category/frequency/type last used with each
 * description, so re-typing "Tesco" restores its usual tagging.
 */
export function buildPayeeMemory(people) {
  const memory = new Map();
  people.forEach((person) => {
    person.entries.forEach((entry) => {
      const key = entry.description.trim().toLowerCase();
      if (!key) return;
      memory.set(key, { category: entry.category || 'Other', frequency: entry.frequency || 'monthly', type: entry.type });
    });
  });
  return memory;
}

export function lookupPayee(memory, description) {
  return memory.get((description || '').trim().toLowerCase()) || null;
}

/**
 * Categories to offer as chips: most recently used first, then presets,
 * deduplicated and capped. Pass type 'all' to draw recents from every entry
 * (the chip row is shown before the user picks incoming/outgoing).
 */
export function chipCategories(people, presets, type = 'all', limit = 10) {
  const recent = [];
  people.forEach((person) => {
    [...person.entries].reverse().forEach((entry) => {
      if ((type === 'all' || entry.type === type) && entry.category && !recent.includes(entry.category)) {
        recent.push(entry.category);
      }
    });
  });
  const merged = [...recent, ...presets.filter((preset) => !recent.includes(preset))];
  return merged.slice(0, limit);
}
