import { describe, it, expect } from 'vitest';
import { computeMetrics, calculateAllocations, computeSharedTotals } from '../src/calculations.js';

describe('computeMetrics', () => {
  it('sums income and expense entries separately and derives net', () => {
    const entries = [
      { type: 'income', amount: 1000 },
      { type: 'income', amount: 200 },
      { type: 'expense', amount: 300 },
    ];
    expect(computeMetrics(entries)).toEqual({ income: 1200, expense: 300, net: 900 });
  });

  it('handles an empty entry list', () => {
    expect(computeMetrics([])).toEqual({ income: 0, expense: 0, net: 0 });
  });
});

describe('calculateAllocations', () => {
  it('splits an equal keep and routes the shared percentage from a positive combined net', () => {
    const result = calculateAllocations([{ net: 1000 }, { net: 1000 }], 20);
    expect(result.combinedNet).toBe(2000);
    expect(result.keepPerPerson).toBeCloseTo(800);
    expect(result.shareContributionTotal).toBeCloseTo(400);
    expect(result.perPerson).toHaveLength(2);
    result.perPerson.forEach((person) => {
      expect(person.shareContribution).toBeCloseTo(200);
      expect(person.keep).toBeCloseTo(800);
    });
  });

  it('clamps an out-of-range share percentage', () => {
    const result = calculateAllocations([{ net: 500 }], 150);
    expect(result.sharePercentage).toBe(100);
  });

  it('balances an unequal split so the higher earner funds part of the lower earner\'s keep', () => {
    const result = calculateAllocations([{ net: 2000 }, { net: 0 }], 0);
    const [earner, nonEarner] = result.perPerson;
    expect(earner.keep).toBeCloseTo(1000);
    expect(nonEarner.keep).toBeCloseTo(1000);
    expect(earner.balancingTransfer).toBeCloseTo(-1000);
    expect(nonEarner.balancingTransfer).toBeCloseTo(1000);
    expect(result.shareContributionTotal).toBeCloseTo(0);
  });

  it('never lets a negative combined net produce a positive share target', () => {
    const result = calculateAllocations([{ net: -500 }, { net: 100 }], 50);
    expect(result.shareContributionTotal).toBeCloseTo(0);
  });

  it('supports more than two people', () => {
    const result = calculateAllocations([{ net: 900 }, { net: 900 }, { net: 900 }], 30);
    expect(result.perPerson).toHaveLength(3);
    expect(result.keepPerPerson).toBeCloseTo(630);
  });
});

describe('computeSharedTotals', () => {
  it('adds starting balance, contributions, and direct entries', () => {
    const allocation = { shareContributionTotal: 150 };
    const directEntries = [{ amount: 50 }, { amount: 25 }];
    expect(computeSharedTotals(allocation, 1000, directEntries)).toEqual({
      contributionTotal: 150,
      directTotal: 75,
      total: 1225,
    });
  });

  it('treats a missing allocation as zero contribution', () => {
    expect(computeSharedTotals(null, 100, [])).toEqual({
      contributionTotal: 0,
      directTotal: 0,
      total: 100,
    });
  });
});
