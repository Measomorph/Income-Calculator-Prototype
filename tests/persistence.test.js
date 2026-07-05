import { describe, it, expect } from 'vitest';
import { convertLegacyState } from '../src/persistence.js';

describe('convertLegacyState', () => {
  it('maps the old currency symbol to a currency code', () => {
    expect(convertLegacyState({ currencySymbol: '£' }).currencyCode).toBe('GBP');
    expect(convertLegacyState({ currencySymbol: '$' }).currencyCode).toBe('USD');
    expect(convertLegacyState({ currencySymbol: '€' }).currencyCode).toBe('EUR');
  });

  it('defaults unknown or missing symbols to GBP', () => {
    expect(convertLegacyState({ currencySymbol: '???' }).currencyCode).toBe('GBP');
    expect(convertLegacyState({}).currencyCode).toBe('GBP');
  });

  it('carries people, shared, and snapshots through unchanged', () => {
    const legacy = {
      currencySymbol: '£',
      sharedPercentage: 35,
      people: [{ id: 'p1', name: 'Alex', entries: [{ id: 'e1', description: 'Salary', amount: 2000, type: 'income' }] }],
      shared: { startingBalance: 150, directEntries: [{ id: 'd1', description: 'Bonus', amount: 50 }] },
      snapshots: [{ id: 's1', month: '2026-06' }],
    };
    const converted = convertLegacyState(legacy);
    expect(converted.people).toEqual(legacy.people);
    expect(converted.shared).toEqual(legacy.shared);
    expect(converted.snapshots).toEqual(legacy.snapshots);
    expect(converted.sharedPercentage).toBe(35);
    expect(converted.currencySymbol).toBeUndefined();
  });

  it('returns null for non-object input', () => {
    expect(convertLegacyState(null)).toBeNull();
    expect(convertLegacyState('junk')).toBeNull();
  });
});
