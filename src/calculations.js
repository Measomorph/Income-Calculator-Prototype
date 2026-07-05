import { clampPercentage } from './format.js';

export function computeMetrics(entries) {
  const income = entries
    .filter((entry) => entry.type === 'income')
    .reduce((sum, entry) => sum + entry.amount, 0);

  const expense = entries
    .filter((entry) => entry.type === 'expense')
    .reduce((sum, entry) => sum + entry.amount, 0);

  return { income, expense, net: income - expense };
}

/**
 * @param {Array<{ net: number }>} peopleMetrics - one entry per person, containing at least { net }
 * @param {number} rawSharePercentage
 */
export function calculateAllocations(peopleMetrics, rawSharePercentage) {
  const sharePercentage = clampPercentage(
    Number.isFinite(Number(rawSharePercentage)) ? Number(rawSharePercentage) : 0
  );

  const combinedNet = peopleMetrics.reduce((sum, person) => sum + person.net, 0);
  const positiveCombinedNet = combinedNet > 0 ? combinedNet : 0;
  const desiredShareTarget = (positiveCombinedNet * sharePercentage) / 100;
  const keepPool = combinedNet - desiredShareTarget;
  const keepPerPerson = peopleMetrics.length > 0 ? keepPool / peopleMetrics.length : 0;

  const perPerson = peopleMetrics.map((person) => {
    const rawContribution = person.net - keepPerPerson;
    return {
      rawContribution,
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
      const usedForBalancing = item.positive - item.shareContribution;
      item.balancingTransfer = -usedForBalancing;
    } else if (item.deficit > 0) {
      item.shareContribution = 0;
      item.balancingTransfer = item.deficit;
    } else {
      item.shareContribution = 0;
      item.balancingTransfer = 0;
    }
  });

  const shareContributionTotal = perPerson.reduce((sum, item) => sum + item.shareContribution, 0);

  return {
    sharePercentage,
    combinedNet,
    keepPerPerson,
    shareContributionTotal,
    perPerson,
  };
}

export function computeSharedTotals(allocation, sharedStartingBalance, sharedDirectEntries) {
  const contributionTotal = allocation?.shareContributionTotal || 0;
  const directTotal = sharedDirectEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const total = sharedStartingBalance + contributionTotal + directTotal;
  return { contributionTotal, directTotal, total };
}
