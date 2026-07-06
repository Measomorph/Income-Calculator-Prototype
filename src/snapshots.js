import { createId, formatMonthLabel, formatTimestamp } from './format.js';

// Okabe-Ito rotation for dynamically assigned category series.
const CATEGORY_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#D55E00', '#CC79A7', '#0072B2', '#F0E442'];
const CATEGORY_DASHES = [[], [8, 4], [2, 4], [8, 4, 2, 4], [12, 4]];

// Okabe-Ito colorblind-safe palette, plus a dash pattern per series so the
// lines stay distinguishable without relying on color alone.
const SERIES = {
  net: { label: 'Net', color: '#E69F00', dash: [], getValue: (s) => s.overall?.net ?? 0 },
  income: { label: 'Income', color: '#0072B2', dash: [8, 4], getValue: (s) => s.overall?.income ?? 0 },
  expense: { label: 'Expense', color: '#D55E00', dash: [2, 4], getValue: (s) => -(s.overall?.expense ?? 0) },
  shared: { label: 'Shared total', color: '#009E73', dash: [8, 4, 2, 4], getValue: (s) => s.shared?.total ?? 0 },
};

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Draws a message word-wrapped to the canvas width instead of clipping. */
function drawWrappedMessage(ctx, text, maxWidth, height) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  const lineHeight = 20;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((textLine, index) => {
    ctx.fillText(textLine, 16, startY + index * lineHeight);
  });
}

export function createSnapshotsController({
  snapshotForm,
  snapshotMonthInput,
  snapshotList,
  snapshotStatus,
  snapshotChart,
  chartLegend,
  trendsChart,
  trendsLegend,
  formatCurrency,
  getPeople,
  getAllocation,
  getPrimaryAccount,
  getInterval,
  onChange,
  undoable,
}) {
  const monthlySnapshots = [];
  let lastChartData = [];
  const activeSeries = new Set(['net', 'shared']);

  function announce(message) {
    if (!snapshotStatus) return;
    snapshotStatus.textContent = message;
    setTimeout(() => {
      if (snapshotStatus.textContent === message) {
        snapshotStatus.textContent = '';
      }
    }, 4000);
  }

  function initializeSnapshotMonth() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    snapshotMonthInput.value = `${now.getFullYear()}-${month}`;
  }

  function buildSnapshotPayload(monthKey) {
    const people = getPeople();
    const allocation = getAllocation();
    const primary = getPrimaryAccount();
    const overallIncome = people.reduce((sum, person) => sum + person.metrics.income, 0);
    const overallExpense = people.reduce((sum, person) => sum + person.metrics.expense, 0);

    const byCategory = {};
    people.forEach((person) => {
      Object.entries(person.metrics.byCategory.expense).forEach(([category, amount]) => {
        byCategory[category] = (byCategory[category] || 0) + amount;
      });
    });

    return {
      byCategory,
      id: createId(),
      month: monthKey,
      capturedAt: new Date().toISOString(),
      interval: getInterval(),
      allocation: {
        strategy: allocation?.strategy ?? 'equal-keeps',
        sharePercentage: allocation?.sharePercentage ?? 0,
        keepPerPerson: allocation?.keepPerPerson ?? 0,
      },
      people: people.map((person, index) => {
        const alloc = allocation?.perPerson?.[index] || { keep: 0, shareContribution: 0, balancingTransfer: 0 };
        return {
          id: person.id,
          name: person.nameInput.value.trim() || `Person ${index + 1}`,
          metrics: { income: person.metrics.income, expense: person.metrics.expense, net: person.metrics.net },
          allocation: {
            keep: alloc.keep,
            shareContribution: alloc.shareContribution,
            balancingTransfer: alloc.balancingTransfer,
          },
        };
      }),
      shared: {
        total: primary?.projectedBalance ?? 0,
      },
      overall: {
        income: overallIncome,
        expense: overallExpense,
        net: allocation?.combinedNet ?? (overallIncome - overallExpense),
      },
    };
  }

  function render() {
    snapshotList.innerHTML = '';
    if (monthlySnapshots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'snapshot-empty';
      empty.textContent = 'No snapshots captured yet. Log one above to begin your history.';
      snapshotList.appendChild(empty);
      drawChart([]);
      drawTrends([]);
      return;
    }

    const ordered = [...monthlySnapshots].sort((a, b) => a.month.localeCompare(b.month));
    ordered.forEach((snapshot) => {
      const item = document.createElement('div');
      item.className = 'snapshot-item';
      item.dataset.snapshotId = snapshot.id;

      const header = document.createElement('div');
      header.className = 'snapshot-header';

      const title = document.createElement('div');
      title.className = 'snapshot-title';
      title.innerHTML = `<strong>${formatMonthLabel(snapshot.month)}</strong><span class="snapshot-meta">Captured ${formatTimestamp(snapshot.capturedAt)}</span>`;

      const total = document.createElement('div');
      total.className = 'snapshot-total';
      total.textContent = formatCurrency(snapshot.overall?.net ?? 0);

      header.append(title, total);

      const metrics = document.createElement('div');
      metrics.className = 'snapshot-metrics';
      (snapshot.people || []).forEach((person) => {
        const keepAmount = person.allocation?.keep ?? person.metrics?.net ?? 0;
        const shareAmount = person.allocation?.shareContribution ?? 0;
        const pill = document.createElement('span');
        pill.innerHTML = `<small>${person.name}</small>${formatCurrency(keepAmount)}<span class="metric-note">Keep · Shared ${formatCurrency(shareAmount)}</span>`;
        metrics.appendChild(pill);
      });

      const sharedSummary = document.createElement('span');
      const sharePercentage = snapshot.allocation?.sharePercentage;
      sharedSummary.innerHTML = `<small>Shared</small>${formatCurrency(snapshot.shared?.total ?? 0)}<span class="metric-note">${typeof sharePercentage === 'number' ? `Share ${sharePercentage}%` : 'Shared total'}</span>`;
      metrics.appendChild(sharedSummary);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'no-print';
      remove.dataset.action = 'remove-snapshot';
      remove.dataset.snapshotId = snapshot.id;
      remove.textContent = 'Delete snapshot';

      item.append(header, metrics, remove);
      snapshotList.appendChild(item);
    });

    drawChart(ordered);
    drawTrends(ordered);
  }

  function drawChart(data) {
    lastChartData = data;
    if (!snapshotChart) return;
    const ctx = snapshotChart.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = snapshotChart.clientWidth || 600;
    const height = snapshotChart.clientHeight || 220;

    snapshotChart.width = width * dpr;
    snapshotChart.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const chartBg = cssVar('--chart-bg', 'rgba(148, 163, 184, 0.15)');
    const chartText = cssVar('--chart-text', '#94a3b8');
    const chartGrid = cssVar('--chart-grid', 'rgba(148, 163, 184, 0.4)');
    const pointOutline = cssVar('--chart-point-outline', '#0f172a');

    ctx.fillStyle = chartBg;
    ctx.fillRect(0, 0, width, height);

    const seriesKeys = Object.keys(SERIES).filter((key) => activeSeries.has(key));

    if (!data.length || seriesKeys.length === 0) {
      ctx.fillStyle = chartText;
      ctx.font = '14px "Segoe UI", sans-serif';
      drawWrappedMessage(
        ctx,
        !data.length ? 'Snapshots will render here once captured.' : 'Select at least one series to plot.',
        width - 32,
        height
      );
      return;
    }

    const padding = { top: 20, right: 24, bottom: 40, left: 48 };
    const months = data.map((snapshot) => snapshot.month);
    const seriesValues = seriesKeys.map((key) => data.map((snapshot) => SERIES[key].getValue(snapshot)));
    const allValues = seriesValues.flat();
    const minValue = Math.min(0, ...allValues);
    const maxValue = Math.max(0, ...allValues);
    const range = maxValue - minValue || 1;

    function xForIndex(index) {
      if (data.length === 1) return padding.left + (width - padding.left - padding.right) / 2;
      const step = (width - padding.left - padding.right) / (data.length - 1);
      return padding.left + index * step;
    }

    function yForValue(value) {
      const normalized = (value - minValue) / range;
      return padding.top + (1 - normalized) * (height - padding.top - padding.bottom);
    }

    ctx.strokeStyle = chartGrid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    const zeroY = yForValue(0);
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    seriesKeys.forEach((key, seriesIndex) => {
      const values = seriesValues[seriesIndex];
      const config = SERIES[key];

      ctx.strokeStyle = config.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(config.dash);
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = xForIndex(index);
        const y = yForValue(value);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);

      values.forEach((value, index) => {
        const x = xForIndex(index);
        const y = yForValue(value);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = config.color;
        ctx.fill();
        ctx.strokeStyle = pointOutline;
        ctx.stroke();
      });
    });

    ctx.fillStyle = chartText;
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    months.forEach((month, index) => {
      const x = xForIndex(index);
      ctx.fillText(formatMonthLabel(month), x, height - 16);
    });

    ctx.textAlign = 'right';
    ctx.fillText(formatCurrency(maxValue), width - 12, padding.top + 12);
    ctx.fillText(formatCurrency(minValue), width - 12, height - padding.bottom);
  }

  /** Line chart of the top expense categories across snapshots. */
  function drawTrends(data) {
    if (!trendsChart) return;
    const ctx = trendsChart.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = trendsChart.clientWidth || 600;
    const height = trendsChart.clientHeight || 200;

    trendsChart.width = width * dpr;
    trendsChart.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = cssVar('--chart-bg', 'rgba(148, 163, 184, 0.15)');
    ctx.fillRect(0, 0, width, height);

    const withCategories = data.filter((snapshot) => snapshot.byCategory && Object.keys(snapshot.byCategory).length);
    if (trendsLegend) trendsLegend.innerHTML = '';
    if (withCategories.length < 2) {
      ctx.fillStyle = cssVar('--chart-text', '#94a3b8');
      ctx.font = '14px "Segoe UI", sans-serif';
      drawWrappedMessage(ctx, 'Category trends appear once two or more snapshots include category data.', width - 32, height);
      return;
    }

    const totals = {};
    withCategories.forEach((snapshot) => {
      Object.entries(snapshot.byCategory).forEach(([category, amount]) => {
        totals[category] = (totals[category] || 0) + amount;
      });
    });
    const topCategories = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);

    const padding = { top: 16, right: 24, bottom: 36, left: 48 };
    const maxValue = Math.max(1, ...withCategories.flatMap(
      (snapshot) => topCategories.map((category) => snapshot.byCategory[category] || 0)
    ));

    const xForIndex = (index) => withCategories.length === 1
      ? padding.left + (width - padding.left - padding.right) / 2
      : padding.left + (index * (width - padding.left - padding.right)) / (withCategories.length - 1);
    const yForValue = (value) => padding.top + (1 - value / maxValue) * (height - padding.top - padding.bottom);

    topCategories.forEach((category, seriesIndex) => {
      const color = CATEGORY_COLORS[seriesIndex % CATEGORY_COLORS.length];
      const dash = CATEGORY_DASHES[seriesIndex % CATEGORY_DASHES.length];

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      withCategories.forEach((snapshot, index) => {
        const x = xForIndex(index);
        const y = yForValue(snapshot.byCategory[category] || 0);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      if (trendsLegend) {
        const item = document.createElement('span');
        item.className = 'trend-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.background = color;
        item.append(swatch, document.createTextNode(` ${category}`));
        trendsLegend.appendChild(item);
      }
    });

    ctx.fillStyle = cssVar('--chart-text', '#94a3b8');
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    withCategories.forEach((snapshot, index) => {
      ctx.fillText(formatMonthLabel(snapshot.month), xForIndex(index), height - 14);
    });
    ctx.textAlign = 'right';
    ctx.fillText(formatCurrency(maxValue), width - 12, padding.top + 12);
  }

  window.addEventListener('resize', () => {
    if (lastChartData.length) {
      drawChart(lastChartData);
      drawTrends(lastChartData);
    }
  });

  if (chartLegend) {
    chartLegend.querySelectorAll('.legend-swatch').forEach((swatch) => {
      const config = SERIES[swatch.dataset.swatch];
      if (config) swatch.style.background = config.color;
    });
    chartLegend.querySelectorAll('input[type="checkbox"][data-series]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const key = checkbox.dataset.series;
        if (checkbox.checked) {
          activeSeries.add(key);
        } else {
          activeSeries.delete(key);
        }
        drawChart(lastChartData);
      });
    });
  }

  snapshotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const monthKey = snapshotMonthInput.value || (() => {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return `${now.getFullYear()}-${month}`;
    })();

    const payload = buildSnapshotPayload(monthKey);
    const existingIndex = monthlySnapshots.findIndex((snapshot) => snapshot.month === monthKey);
    if (existingIndex >= 0) {
      payload.id = monthlySnapshots[existingIndex].id;
      monthlySnapshots[existingIndex] = payload;
      announce(`Updated snapshot for ${formatMonthLabel(monthKey)}.`);
    } else {
      monthlySnapshots.push(payload);
      announce(`Captured snapshot for ${formatMonthLabel(monthKey)}.`);
    }

    render();
    onChange();
  });

  snapshotList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === 'remove-snapshot') {
      const snapshotId = target.dataset.snapshotId;
      const snapshot = monthlySnapshots.find((s) => s.id === snapshotId);
      if (!snapshot) return;
      undoable(`Deleted snapshot for ${formatMonthLabel(snapshot.month)}`, () => {
        const index = monthlySnapshots.indexOf(snapshot);
        if (index >= 0) monthlySnapshots.splice(index, 1);
        render();
      });
    }
  });

  function getState() {
    return monthlySnapshots.map((snapshot) => ({ ...snapshot }));
  }

  function setState(snapshots) {
    monthlySnapshots.splice(0, monthlySnapshots.length);
    if (Array.isArray(snapshots)) {
      monthlySnapshots.push(...snapshots.map((snapshot) => ({ ...snapshot, id: snapshot.id || createId() })));
    }
  }

  initializeSnapshotMonth();

  return {
    render,
    getState,
    setState,
    redrawChart: () => {
      drawChart(lastChartData);
      drawTrends(lastChartData);
    },
  };
}
