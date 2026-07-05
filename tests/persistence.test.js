import { describe, it, expect } from 'vitest';
import { convertLegacyState, migrateToV4 } from '../src/persistence.js';

describe('migrateToV4', () => {
  it('upgrades a v3 payload: entries gain frequency/category, shared becomes primary account', () => {
    const v3 = {
      currencyCode: 'EUR',
      sharedPercentage: 42,
      people: [{ id: 'p1', name: 'Alex', entries: [{ id: 'e1', description: 'Salary', amount: 2000, type: 'income' }] }],
      shared: { startingBalance: 250, directEntries: [{ id: 'd1', description: 'Bonus', amount: 75 }] },
      snapshots: [{ id: 's1', month: '2026-05' }],
    };
    const v4 = migrateToV4(v3);
    expect(v4.version).toBe(4);
    expect(v4.currencyCode).toBe('EUR');
    expect(v4.split).toEqual({ strategy: 'equal-keeps', sharedPercentage: 42, customShares: {} });
    expect(v4.people[0].entries[0].frequency).toBe('monthly');
    expect(v4.people[0].entries[0].category).toBe('Other');
    expect(v4.accounts).toHaveLength(1);
    expect(v4.accounts[0]).toMatchObject({ id: 'shared', primary: true, startingBalance: 250 });
    expect(v4.accounts[0].directEntries).toHaveLength(1);
    expect(v4.snapshots).toHaveLength(1);
  });

  it('passes a v4 payload through untouched', () => {
    const v4 = { version: 4, currencyCode: 'GBP', people: [], accounts: [] };
    expect(migrateToV4(v4)).toBe(v4);
  });

  it('chains from v2 via convertLegacyState', () => {
    const v2 = { currencySymbol: '£', sharedPercentage: 30, people: [], shared: { startingBalance: 10, directEntries: [] } };
    const v4 = migrateToV4(convertLegacyState(v2));
    expect(v4.version).toBe(4);
    expect(v4.currencyCode).toBe('GBP');
    expect(v4.split.sharedPercentage).toBe(30);
  });

  it('returns null for garbage', () => {
    expect(migrateToV4(null)).toBeNull();
  });
});

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
