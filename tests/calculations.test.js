import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  calculateSplit,
  computeAccountFlows,
  computeSharedTotals,
} from '../src/calculations.js';
import { normalizeAmount } from '../src/frequency.js';

describe('normalizeAmount', () => {
  it('converts weekly amounts to monthly equivalents', () => {
    expect(normalizeAmount(120, 'weekly', 'month')).toBeCloseTo((120 * 52) / 12);
  });

  it('converts yearly amounts down to weekly equivalents', () => {
    expect(normalizeAmount(52000, 'yearly', 'week')).toBeCloseTo(1000);
  });

  it('keeps amounts unchanged when frequency matches interval', () => {
    expect(normalizeAmount(500, 'monthly', 'month')).toBe(500);
  });

  it('counts one-off amounts once at face value in any view', () => {
    expect(normalizeAmount(250, 'once', 'day')).toBe(250);
    expect(normalizeAmount(250, 'once', 'year')).toBe(250);
  });

  it('treats unknown frequency as one-off and bad amounts as zero', () => {
    expect(normalizeAmount(100, 'nonsense', 'month')).toBe(100);
    expect(normalizeAmount(NaN, 'monthly', 'month')).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('normalizes mixed-frequency entries into the selected interval', () => {
    const entries = [
      { type: 'income', amount: 1200, frequency: 'monthly', category: 'Salary' },
      { type: 'income', amount: 300, frequency: 'weekly', category: 'Freelance' },
      { type: 'expense', amount: 100, frequency: 'weekly', category: 'Food' },
    ];
    const metrics = computeMetrics(entries, 'month');
    expect(metrics.income).toBeCloseTo(1200 + (300 * 52) / 12);
    expect(metrics.expense).toBeCloseTo((100 * 52) / 12);
    expect(metrics.net).toBeCloseTo(metrics.income - metrics.expense);
  });

  it('accumulates per-category totals', () => {
    const entries = [
      { type: 'expense', amount: 100, frequency: 'monthly', category: 'Food' },
      { type: 'expense', amount: 50, frequency: 'monthly', category: 'Food' },
      { type: 'expense', amount: 80, frequency: 'monthly' },
    ];
    const metrics = computeMetrics(entries, 'month');
    expect(metrics.byCategory.expense.Food).toBeCloseTo(150);
    expect(metrics.byCategory.expense.Other).toBeCloseTo(80);
  });
});

describe('calculateSplit: equal-keeps', () => {
  it('splits an equal keep and routes the shared percentage', () => {
    const result = calculateSplit([1000, 1000], { strategy: 'equal-keeps', sharedPercentage: 20 });
    expect(result.keepPerPerson).toBeCloseTo(800);
    expect(result.shareContributionTotal).toBeCloseTo(400);
  });

  it('balances unequal earners through transfers', () => {
    const result = calculateSplit([2000, 0], { strategy: 'equal-keeps', sharedPercentage: 0 });
    expect(result.perPerson[0].balancingTransfer).toBeCloseTo(-1000);
    expect(result.perPerson[1].balancingTransfer).toBeCloseTo(1000);
  });
});

describe('calculateSplit: proportional', () => {
  it('splits contributions in proportion to income', () => {
    const result = calculateSplit([3000, 1000], { strategy: 'proportional', sharedPercentage: 50 });
    expect(result.shareContributionTotal).toBeCloseTo(2000);
    expect(result.perPerson[0].shareContribution).toBeCloseTo(1500);
    expect(result.perPerson[1].shareContribution).toBeCloseTo(500);
    expect(result.perPerson[0].keep).toBeCloseTo(1500);
    expect(result.perPerson[1].keep).toBeCloseTo(500);
  });

  it('excludes negative nets from contributing', () => {
    const result = calculateSplit([2000, -500], { strategy: 'proportional', sharedPercentage: 50 });
    expect(result.perPerson[1].shareContribution).toBe(0);
    expect(result.perPerson[1].keep).toBe(-500);
  });
});

describe('calculateSplit: even', () => {
  it('has everyone contribute the same amount', () => {
    const result = calculateSplit([3000, 1000], { strategy: 'even', sharedPercentage: 50 });
    expect(result.perPerson[0].shareContribution).toBeCloseTo(1000);
    expect(result.perPerson[1].shareContribution).toBeCloseTo(1000);
  });

  it('caps a contribution at the person\'s positive net and reports the shortfall', () => {
    const result = calculateSplit([3000, 200], { strategy: 'even', sharedPercentage: 50 });
    expect(result.perPerson[1].shareContribution).toBeCloseTo(200);
    expect(result.perPerson[1].shortfall).toBeCloseTo(600);
  });
});

describe('calculateSplit: custom', () => {
  it('applies each person\'s own percentage of their net', () => {
    const result = calculateSplit([2000, 1000], { strategy: 'custom', customShares: [30, 10] });
    expect(result.perPerson[0].shareContribution).toBeCloseTo(600);
    expect(result.perPerson[1].shareContribution).toBeCloseTo(100);
  });

  it('clamps percentages and skips negative nets', () => {
    const result = calculateSplit([1000, -400], { strategy: 'custom', customShares: [150, 50] });
    expect(result.perPerson[0].shareContribution).toBeCloseTo(1000);
    expect(result.perPerson[1].shareContribution).toBe(0);
  });
});

describe('computeAccountFlows', () => {
  const people = [
    { id: 'p1', metrics: { income: 3000 } },
    { id: 'p2', metrics: { income: 1000 } },
  ];

  it('routes a percentage of one person\'s income into an account', () => {
    const accounts = [{ id: 'tax', rules: [{ id: 'r1', personId: 'p1', basis: 'percent', value: 20 }] }];
    const flows = computeAccountFlows(people, accounts, 'month');
    expect(flows.accountInflows.tax).toBeCloseTo(600);
    expect(flows.deductionsPerPerson.p1).toBeCloseTo(600);
    expect(flows.deductionsPerPerson.p2).toBe(0);
  });

  it('supports rules that apply to everyone', () => {
    const accounts = [{ id: 'pension', rules: [{ id: 'r1', personId: 'all', basis: 'percent', value: 5 }] }];
    const flows = computeAccountFlows(people, accounts, 'month');
    expect(flows.accountInflows.pension).toBeCloseTo(150 + 50);
  });

  it('normalizes fixed-amount rules across intervals', () => {
    const accounts = [{ id: 'save', rules: [{ id: 'r1', personId: 'p1', basis: 'fixed', value: 120, frequency: 'weekly' }] }];
    const flows = computeAccountFlows(people, accounts, 'month');
    expect(flows.accountInflows.save).toBeCloseTo((120 * 52) / 12);
  });

  it('accumulates multiple rules and reports per-rule amounts', () => {
    const accounts = [
      {
        id: 'tax',
        rules: [
          { id: 'r1', personId: 'p1', basis: 'percent', value: 20 },
          { id: 'r2', personId: 'p1', basis: 'percent', value: 9 },
        ],
      },
    ];
    const flows = computeAccountFlows(people, accounts, 'month');
    expect(flows.accountInflows.tax).toBeCloseTo(600 + 270);
    expect(flows.ruleAmounts.r1).toBeCloseTo(600);
    expect(flows.ruleAmounts.r2).toBeCloseTo(270);
  });
});

describe('computeSharedTotals', () => {
  it('adds starting balance, contributions, and direct entries', () => {
    const allocation = { shareContributionTotal: 150 };
    expect(computeSharedTotals(allocation, 1000, [{ amount: 50 }, { amount: 25 }])).toEqual({
      contributionTotal: 150,
      directTotal: 75,
      total: 1225,
    });
  });
});
