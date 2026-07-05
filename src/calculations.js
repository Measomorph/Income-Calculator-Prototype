import { clampPercentage } from './format.js';
import { normalizeAmount, INTERVALS } from './frequency.js';

/**
 * Applies tax-style bands to an annual amount: each band taxes the slice of
 * income between `from` and `to` (null = unbounded) at `rate` percent.
 */
export function applyBands(annualAmount, bands) {
  return (bands || []).reduce((total, band) => {
    const from = Number(band.from) || 0;
    const to = band.to == null ? Infinity : Number(band.to);
    const slice = Math.min(annualAmount, to) - from;
    if (slice <= 0) return total;
    return total + (slice * (Number(band.rate) || 0)) / 100;
  }, 0);
}

/**
 * Sums a person's entries over the selected display interval.
 * Returns income/expense/net plus per-category totals.
 */
export function computeMetrics(entries, interval = 'month') {
  const metrics = { income: 0, expense: 0, net: 0, byCategory: { income: {}, expense: {} } };

  entries.forEach((entry) => {
    const amount = normalizeAmount(entry.amount, entry.frequency, interval);
    const type = entry.type === 'expense' ? 'expense' : 'income';
    metrics[type] += amount;
    const category = (entry.category || 'Other').trim() || 'Other';
    metrics.byCategory[type][category] = (metrics.byCategory[type][category] || 0) + amount;
  });

  metrics.net = metrics.income - metrics.expense;
  return metrics;
}

export const SPLIT_STRATEGIES = {
  'equal-keeps': {
    label: 'Equal keeps',
    description: 'Everyone keeps the same amount; the rest goes to the shared pot, with balancing transfers between partners.',
    usesSharedPercentage: true,
  },
  proportional: {
    label: 'Proportional to income',
    description: 'Each person contributes to the shared pot in proportion to their net income.',
    usesSharedPercentage: true,
  },
  even: {
    label: '50/50 even split',
    description: 'Everyone contributes the same amount to the shared pot, regardless of income.',
    usesSharedPercentage: true,
  },
  custom: {
    label: 'Custom percentages',
    description: 'Each person contributes their own chosen percentage of their net.',
    usesSharedPercentage: false,
  },
};

function emptyAllocation(nets, sharePercentage) {
  return {
    strategy: 'equal-keeps',
    sharePercentage,
    combinedNet: nets.reduce((sum, n) => sum + n, 0),
    keepPerPerson: 0,
    shareContributionTotal: 0,
    perPerson: nets.map((net) => ({
      shareContribution: 0,
      keep: net,
      balancingTransfer: 0,
    })),
  };
}

function equalKeeps(nets, sharePercentage) {
  const combinedNet = nets.reduce((sum, net) => sum + net, 0);
  const positiveCombinedNet = combinedNet > 0 ? combinedNet : 0;
  const desiredShareTarget = (positiveCombinedNet * sharePercentage) / 100;
  const keepPool = combinedNet - desiredShareTarget;
  const keepPerPerson = nets.length > 0 ? keepPool / nets.length : 0;

  const perPerson = nets.map((net) => {
    const rawContribution = net - keepPerPerson;
    return {
      positive: Math.max(0, rawContribution),
      deficit: Math.max(0, -rawContribution),
      shareContribution: 0,
      keep: keepPerPerson,
      balancingTransfer: 0,
    };
  });

  const totalPositive = perPerson.reduce((sum, item) => sum + item.positive, 0);
  const totalDeficit = perPerson.reduce((sum, item) => sum + item.deficit, 0);
  const theoreticalShareTarget = Math.max(0, totalPositive - totalDeficit);
  const shareTarget = Math.min(theoreticalShareTarget, Math.max(0, desiredShareTarget));
  const ratio = totalPositive > 0 ? shareTarget / totalPositive : 0;

  perPerson.forEach((item) => {
    if (item.positive > 0) {
      item.shareContribution = item.positive * ratio;
      item.balancingTransfer = -(item.positive - item.shareContribution);
    } else if (item.deficit > 0) {
      item.balancingTransfer = item.deficit;
    }
    delete item.positive;
    delete item.deficit;
  });

  return {
    strategy: 'equal-keeps',
    sharePercentage,
    combinedNet,
    keepPerPerson,
    shareContributionTotal: perPerson.reduce((sum, item) => sum + item.shareContribution, 0),
    perPerson,
  };
}

function proportional(nets, sharePercentage) {
  const combinedNet = nets.reduce((sum, net) => sum + net, 0);
  const positiveCombinedNet = Math.max(0, combinedNet);
  const totalPositive = nets.reduce((sum, net) => sum + Math.max(0, net), 0);
  const target = Math.min((positiveCombinedNet * sharePercentage) / 100, totalPositive);

  const perPerson = nets.map((net) => {
    const positive = Math.max(0, net);
    const shareContribution = totalPositive > 0 ? (target * positive) / totalPositive : 0;
    return {
      shareContribution,
      keep: net - shareContribution,
      balancingTransfer: 0,
    };
  });

  return {
    strategy: 'proportional',
    sharePercentage,
    combinedNet,
    keepPerPerson: 0,
    shareContributionTotal: perPerson.reduce((sum, item) => sum + item.shareContribution, 0),
    perPerson,
  };
}

function evenSplit(nets, sharePercentage) {
  const combinedNet = nets.reduce((sum, net) => sum + net, 0);
  const positiveCombinedNet = Math.max(0, combinedNet);
  const target = (positiveCombinedNet * sharePercentage) / 100;
  const perHead = nets.length > 0 ? target / nets.length : 0;

  const perPerson = nets.map((net) => {
    const shareContribution = Math.min(perHead, Math.max(0, net));
    return {
      shareContribution,
      keep: net - shareContribution,
      balancingTransfer: 0,
      shortfall: Math.max(0, perHead - shareContribution),
    };
  });

  return {
    strategy: 'even',
    sharePercentage,
    combinedNet,
    keepPerPerson: 0,
    shareContributionTotal: perPerson.reduce((sum, item) => sum + item.shareContribution, 0),
    perPerson,
  };
}

function customSplit(nets, customShares) {
  const combinedNet = nets.reduce((sum, net) => sum + net, 0);

  const perPerson = nets.map((net, index) => {
    const pct = clampPercentage(Number(customShares?.[index]) || 0);
    const shareContribution = Math.max(0, net) * (pct / 100);
    return {
      shareContribution,
      keep: net - shareContribution,
      balancingTransfer: 0,
      customPercentage: pct,
    };
  });

  return {
    strategy: 'custom',
    sharePercentage: null,
    combinedNet,
    keepPerPerson: 0,
    shareContributionTotal: perPerson.reduce((sum, item) => sum + item.shareContribution, 0),
    perPerson,
  };
}

/**
 * @param {number[]} nets - one net figure per person (after account-rule deductions)
 * @param {{ strategy: string, sharedPercentage?: number, customShares?: number[] }} config
 */
export function calculateSplit(nets, config = {}) {
  const sharePercentage = clampPercentage(
    Number.isFinite(Number(config.sharedPercentage)) ? Number(config.sharedPercentage) : 0
  );
  if (nets.length === 0) return emptyAllocation(nets, sharePercentage);

  switch (config.strategy) {
    case 'proportional':
      return proportional(nets, sharePercentage);
    case 'even':
      return evenSplit(nets, sharePercentage);
    case 'custom':
      return customSplit(nets, config.customShares || []);
    case 'equal-keeps':
    default:
      return equalKeeps(nets, sharePercentage);
  }
}

/**
 * Applies each account's allocation rules to people's incomes.
 * A rule routes either a percentage of one person's income (or everyone's)
 * or a fixed recurring amount into the account, before any split happens.
 *
 * @param {Array<{ id: string, metrics: { income: number } }>} people
 * @param {Array<{ id: string, rules: Array<{ personId: string, basis: 'percent'|'fixed', value: number, frequency?: string }> }>} accounts
 * @param {string} interval
 * @returns {{ accountInflows: Record<string, number>, deductionsPerPerson: Record<string, number>, ruleAmounts: Record<string, number> }}
 */
export function computeAccountFlows(people, accounts, interval = 'month') {
  const accountInflows = {};
  const deductionsPerPerson = {};
  const ruleAmounts = {};
  people.forEach((person) => {
    deductionsPerPerson[person.id] = 0;
  });

  accounts.forEach((account) => {
    let inflow = 0;
    (account.rules || []).forEach((rule) => {
      const targets = rule.personId === 'all' ? people : people.filter((p) => p.id === rule.personId);
      let ruleTotal = 0;
      targets.forEach((person) => {
        let amount = 0;
        if (rule.basis === 'percent') {
          amount = (Math.max(0, person.metrics.income) * clampPercentage(Number(rule.value) || 0)) / 100;
        } else if (rule.basis === 'band') {
          const annualIncome = Math.max(0, person.metrics.income) * (INTERVALS[interval]?.perYear || 12);
          amount = normalizeAmount(applyBands(annualIncome, rule.bands), 'yearly', interval);
        } else {
          amount = normalizeAmount(rule.value, rule.frequency || 'monthly', interval);
        }
        deductionsPerPerson[person.id] = (deductionsPerPerson[person.id] || 0) + amount;
        ruleTotal += amount;
      });
      ruleAmounts[rule.id] = ruleTotal;
      inflow += ruleTotal;
    });
    accountInflows[account.id] = inflow;
  });

  return { accountInflows, deductionsPerPerson, ruleAmounts };
}

// HMRC 2025/26 figures. An estimate on gross income (not taxed profit after
// allowable expenses), so presented in the UI as guidance only.
export const UK_TAX_PRESETS = {
  incomeTax: {
    name: 'Income Tax (est.)',
    bands: [
      { from: 12570, to: 50270, rate: 20 },
      { from: 50270, to: 125140, rate: 40 },
      { from: 125140, to: null, rate: 45 },
    ],
  },
  class4Ni: {
    name: 'Class 4 NI (est.)',
    bands: [
      { from: 12570, to: 50270, rate: 6 },
      { from: 50270, to: null, rate: 2 },
    ],
  },
};

/**
 * Steady-state monthly inflow rate for each account (rules plus, for the
 * primary account, split contributions), used for projections and goal ETAs.
 * One-off direct additions are excluded — they aren't a recurring rate.
 */
export function computeMonthlyOutlook(people, accounts, splitConfig) {
  const monthlyPeople = people.map((person) => ({
    id: person.id,
    metrics: computeMetrics(person.entries.filter((entry) => entry.frequency !== 'once'), 'month'),
  }));
  const flows = computeAccountFlows(monthlyPeople, accounts, 'month');
  const nets = monthlyPeople.map((person) => {
    const deductions = flows.deductionsPerPerson[person.id] || 0;
    return person.metrics.income - person.metrics.expense - deductions;
  });
  const allocation = calculateSplit(nets, splitConfig);

  const rates = {};
  accounts.forEach((account) => {
    rates[account.id] = (flows.accountInflows[account.id] || 0) +
      (account.primary ? allocation.shareContributionTotal : 0);
  });

  const keeps = {};
  monthlyPeople.forEach((person, index) => {
    keeps[person.id] = allocation.perPerson[index]?.keep ?? 0;
  });

  return { rates, keeps };
}

export function computeMonthlyRates(people, accounts, splitConfig) {
  return computeMonthlyOutlook(people, accounts, splitConfig).rates;
}

/**
 * Months until `target` is reached from `current` at `monthlyRate`.
 * Returns 0 when already reached, null when it never will be.
 */
export function monthsToTarget(current, target, monthlyRate) {
  if (current >= target) return 0;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0.005) return null;
  return Math.ceil((target - current) / monthlyRate);
}

export function computeSharedTotals(allocation, sharedStartingBalance, sharedDirectEntries) {
  const contributionTotal = allocation?.shareContributionTotal || 0;
  const directTotal = sharedDirectEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const total = sharedStartingBalance + contributionTotal + directTotal;
  return { contributionTotal, directTotal, total };
}
