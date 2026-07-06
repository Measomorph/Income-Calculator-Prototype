import { describe, it, expect } from 'vitest';
import { applyBands, computeMonthlyRates, monthsToTarget, monthlyInterestRate, projectBalance, computeAccountFlows, UK_TAX_PRESETS } from '../src/calculations.js';
import { encryptState, decryptState, isEncryptedEnvelope } from '../src/crypto.js';
import { parseCSV, guessColumns, parseStatementAmount } from '../src/csv.js';
import { parseQuickEntry, buildPayeeMemory, lookupPayee, chipCategories } from '../src/entry-smarts.js';

describe('applyBands', () => {
  it('taxes each band slice at its rate', () => {
    // £60,000: nothing below 12570, 20% of (50270-12570), 40% of (60000-50270)
    const tax = applyBands(60000, UK_TAX_PRESETS.incomeTax.bands);
    expect(tax).toBeCloseTo(37700 * 0.2 + 9730 * 0.4);
  });

  it('returns zero below the first threshold', () => {
    expect(applyBands(10000, UK_TAX_PRESETS.incomeTax.bands)).toBe(0);
  });

  it('handles unbounded top bands', () => {
    const ni = applyBands(150000, UK_TAX_PRESETS.class4Ni.bands);
    expect(ni).toBeCloseTo(37700 * 0.06 + (150000 - 50270) * 0.02);
  });
});

describe('band rules in computeAccountFlows', () => {
  it('annualizes income, applies bands, and normalizes back to the interval', () => {
    const people = [{ id: 'p1', metrics: { income: 5000 } }]; // £60k/yr at month view
    const accounts = [{
      id: 'tax',
      rules: [{ id: 'r1', personId: 'p1', basis: 'band', bands: UK_TAX_PRESETS.incomeTax.bands }],
    }];
    const flows = computeAccountFlows(people, accounts, 'month');
    const expectedAnnual = 37700 * 0.2 + 9730 * 0.4;
    expect(flows.accountInflows.tax).toBeCloseTo(expectedAnnual / 12);
  });

  it('base "profit" deducts Business-category outgoings before banding', () => {
    // £5,000/mo income, £1,000/mo Business costs -> £48k/yr profit
    const people = [{
      id: 'p1',
      metrics: { income: 5000, byCategory: { expense: { Business: 1000, Food: 400 } } },
    }];
    const accounts = [{
      id: 'tax',
      rules: [{ id: 'r1', personId: 'p1', basis: 'band', base: 'profit', bands: UK_TAX_PRESETS.incomeTax.bands }],
    }];
    const flows = computeAccountFlows(people, accounts, 'month');
    const expectedAnnual = (48000 - 12570) * 0.2; // all within basic rate
    expect(flows.accountInflows.tax).toBeCloseTo(expectedAnnual / 12);
  });

  it('UK presets are marked profit-based', () => {
    expect(UK_TAX_PRESETS.incomeTax.base).toBe('profit');
    expect(UK_TAX_PRESETS.class4Ni.base).toBe('profit');
  });
});

describe('computeMonthlyRates', () => {
  const mkPerson = (id, entries) => ({ id, entries });

  it('excludes one-off entries from the steady-state rate', () => {
    const people = [mkPerson('p1', [
      { type: 'income', amount: 1000, frequency: 'monthly', category: 'Salary' },
      { type: 'income', amount: 5000, frequency: 'once', category: 'Other' },
    ])];
    const accounts = [
      { id: 'shared', primary: true, rules: [] },
      { id: 'save', rules: [{ id: 'r1', personId: 'p1', basis: 'percent', value: 10 }] },
    ];
    const rates = computeMonthlyRates(people, accounts, { strategy: 'even', sharedPercentage: 50 });
    expect(rates.save).toBeCloseTo(100); // 10% of 1000, one-off ignored
    // net = 1000 - 100 = 900; even split target 50% => 450 into primary
    expect(rates.shared).toBeCloseTo(450);
  });
});

describe('monthsToTarget', () => {
  it('computes months at a positive rate', () => {
    expect(monthsToTarget(1000, 5000, 500)).toBe(8);
  });
  it('returns 0 when already reached and null when unreachable', () => {
    expect(monthsToTarget(5000, 5000, 100)).toBe(0);
    expect(monthsToTarget(0, 5000, 0)).toBeNull();
  });
  it('reaches the target sooner when interest compounds', () => {
    const withoutInterest = monthsToTarget(10000, 20000, 200);
    const withInterest = monthsToTarget(10000, 20000, 200, 4.5);
    expect(withInterest).toBeLessThan(withoutInterest);
  });
  it('can reach a target on interest alone', () => {
    // £10k at 4.5% AER doubles in ~15.7 years with no contributions
    const months = monthsToTarget(10000, 20000, 0, 4.5);
    expect(months).toBeGreaterThan(180);
    expect(months).toBeLessThan(195);
  });
  it('stays unreachable with interest but no balance or contributions', () => {
    expect(monthsToTarget(0, 5000, 0, 4.5)).toBeNull();
  });
});

describe('interest projections', () => {
  it('converts AER to a monthly rate that compounds back to the annual figure', () => {
    const monthly = monthlyInterestRate(4.5);
    expect(Math.pow(1 + monthly, 12)).toBeCloseTo(1.045);
    expect(monthlyInterestRate(0)).toBe(0);
    expect(monthlyInterestRate(-2)).toBe(0);
  });

  it('projects contributions without interest linearly', () => {
    expect(projectBalance(1000, 250, 12)).toBe(4000);
  });

  it('grows a lump sum by exactly the AER over 12 months', () => {
    expect(projectBalance(10000, 0, 12, 4.5)).toBeCloseTo(10450);
  });

  it('compounds contributions month by month', () => {
    // Closed form must match a manual month-by-month walk.
    const i = monthlyInterestRate(4.5);
    let manual = 1000;
    for (let m = 0; m < 6; m++) manual = manual * (1 + i) + 250;
    expect(projectBalance(1000, 250, 6, 4.5)).toBeCloseTo(manual);
  });
});

describe('crypto round-trip', () => {
  it('encrypts and decrypts a state object', async () => {
    const state = { version: 5, people: [{ name: 'Alex' }], note: 'Ünïcode £€' };
    const envelope = await encryptState(state, 'correct horse battery');
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('Alex');
    const decrypted = await decryptState(envelope, 'correct horse battery');
    expect(decrypted).toEqual(state);
  });

  it('rejects a wrong passphrase', async () => {
    const envelope = await encryptState({ a: 1 }, 'right');
    await expect(decryptState(envelope, 'wrong')).rejects.toThrow(/passphrase/i);
  });

  it('does not flag plain backups as encrypted', () => {
    expect(isEncryptedEnvelope({ version: 5, people: [] })).toBe(false);
  });
});

describe('parseCSV', () => {
  it('parses quoted fields, escaped quotes, and CRLF', () => {
    const rows = parseCSV('Date,Description,Amount\r\n"01/06/2026","Tesco, Superstore","-45.20"\r\n02/06/2026,"He said ""hi""",100\r\n');
    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01/06/2026', 'Tesco, Superstore', '-45.20'],
      ['02/06/2026', 'He said "hi"', '100'],
    ]);
  });
});

describe('guessColumns', () => {
  it('finds columns from common bank headers', () => {
    expect(guessColumns(['Transaction Date', 'Merchant Name', 'Amount (GBP)'])).toEqual({ date: 0, description: 1, amount: 2 });
  });
});

describe('parseStatementAmount', () => {
  it('handles currency symbols, thousands separators, and parens negatives', () => {
    expect(parseStatementAmount('£1,234.56')).toBeCloseTo(1234.56);
    expect(parseStatementAmount('(45.00)')).toBeCloseTo(-45);
    expect(parseStatementAmount('-12.30')).toBeCloseTo(-12.3);
    expect(parseStatementAmount('1.234,56')).toBeCloseTo(1234.56);
    expect(parseStatementAmount('abc')).toBeNaN();
  });
});

describe('parseQuickEntry', () => {
  it('parses "description amount frequency"', () => {
    expect(parseQuickEntry('Rent 950 monthly')).toEqual({ description: 'Rent', amount: 950, frequency: 'monthly' });
  });
  it('parses amount without frequency', () => {
    expect(parseQuickEntry('Coffee 3.50')).toEqual({ description: 'Coffee', amount: 3.5, frequency: null });
  });
  it('accepts currency symbols and synonyms', () => {
    expect(parseQuickEntry('Salary £2,400 pcm')).toEqual({ description: 'Salary', amount: 2400, frequency: 'monthly' });
  });
  it('leaves plain descriptions alone', () => {
    expect(parseQuickEntry('Weekly shop')).toEqual({ description: 'Weekly shop', amount: null, frequency: null });
    expect(parseQuickEntry('Rent monthly')).toEqual({ description: 'Rent monthly', amount: null, frequency: null });
  });
  it('does not eat a description that is just a number word context', () => {
    expect(parseQuickEntry('Area 51 tour 20 weekly')).toEqual({ description: 'Area 51 tour', amount: 20, frequency: 'weekly' });
  });
});

describe('payee memory', () => {
  const people = [{
    entries: [
      { description: 'Tesco', category: 'Food', frequency: 'weekly', type: 'expense' },
      { description: 'Rent', category: 'Housing', frequency: 'monthly', type: 'expense' },
    ],
  }];

  it('recalls category and frequency case-insensitively', () => {
    const memory = buildPayeeMemory(people);
    expect(lookupPayee(memory, '  tesco ')).toEqual({ category: 'Food', frequency: 'weekly', type: 'expense' });
    expect(lookupPayee(memory, 'unknown')).toBeNull();
  });

  it('offers recent categories before presets in chips', () => {
    const chips = chipCategories(people, ['Housing', 'Transport', 'Bills'], 'expense', 4);
    expect(chips[0]).toBe('Housing'); // most recent entry first
    expect(chips).toContain('Food');
    expect(chips.length).toBeLessThanOrEqual(4);
    expect(new Set(chips).size).toBe(chips.length);
  });
});
