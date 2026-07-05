export const FREQUENCIES = {
  once: { label: 'One-off', perYear: 0 },
  daily: { label: 'Daily', perYear: 365 },
  weekly: { label: 'Weekly', perYear: 52 },
  fortnightly: { label: 'Fortnightly', perYear: 26 },
  monthly: { label: 'Monthly', perYear: 12 },
  quarterly: { label: 'Quarterly', perYear: 4 },
  yearly: { label: 'Yearly', perYear: 1 },
};

export const INTERVALS = {
  day: { label: 'Daily', suffix: '/day', perYear: 365 },
  week: { label: 'Weekly', suffix: '/week', perYear: 52 },
  month: { label: 'Monthly', suffix: '/month', perYear: 12 },
  year: { label: 'Yearly', suffix: '/year', perYear: 1 },
};

/**
 * Converts an entry amount at a given recurrence into its equivalent over the
 * selected display interval, e.g. £120 weekly -> £520 per month.
 * One-off amounts count once at face value regardless of the interval.
 */
export function normalizeAmount(amount, frequency, interval) {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const freq = FREQUENCIES[frequency] || FREQUENCIES.once;
  const view = INTERVALS[interval] || INTERVALS.month;
  if (freq.perYear === 0) return safeAmount;
  return (safeAmount * freq.perYear) / view.perYear;
}
