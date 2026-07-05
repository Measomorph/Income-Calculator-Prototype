export function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampPercentage(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

const CURRENCY_LOCALES = {
  GBP: 'en-GB',
  USD: 'en-US',
  EUR: 'de-DE',
  JPY: 'ja-JP',
  AUD: 'en-AU',
  CAD: 'en-CA',
};

export function formatCurrency(amount, currencyCode = 'GBP') {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const locale = CURRENCY_LOCALES[currencyCode] || undefined;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(safeAmount);
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'GBP',
    }).format(safeAmount);
  }
}

export function formatMonthLabel(value) {
  if (!value) return 'Unknown';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
