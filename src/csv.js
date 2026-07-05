/**
 * Minimal CSV parser handling quoted fields, escaped quotes, and CRLF.
 * Returns an array of row arrays; blank lines are skipped.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

// Checked in order: date wins over description so "Transaction Date"
// isn't mistaken for a description column.
const HEADER_GUESSES = {
  date: ['date', 'posted', 'time'],
  amount: ['amount', 'value', 'debit', 'credit', 'money in', 'money out', 'paid in', 'paid out'],
  description: ['description', 'merchant', 'payee', 'name', 'narrative', 'details', 'reference', 'transaction'],
};

/** Guesses which column index holds each field based on header names. */
export function guessColumns(headerRow) {
  const guesses = { description: -1, amount: -1, date: -1 };
  headerRow.forEach((cell, index) => {
    const lower = cell.trim().toLowerCase();
    // Each column claims at most one field, highest-priority match wins.
    const field = Object.keys(HEADER_GUESSES).find(
      (key) => guesses[key] === -1 && HEADER_GUESSES[key].some((keyword) => lower.includes(keyword))
    );
    if (field) guesses[field] = index;
  });
  return guesses;
}

/** Parses a statement amount like "£1,234.56", "(45.00)", or "-45". */
export function parseStatementAmount(raw) {
  if (raw == null) return NaN;
  let text = String(raw).trim();
  const negativeByParens = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '').replace(/[^0-9.,-]/g, '');
  // If the last comma comes after the last dot, the comma is the decimal
  // separator (European style, e.g. "1.234,56"); otherwise commas are
  // thousands separators.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma !== -1 && lastComma > lastDot && /,\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const value = parseFloat(text);
  if (!Number.isFinite(value)) return NaN;
  return negativeByParens ? -Math.abs(value) : value;
}
