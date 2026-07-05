import { formatCurrency as formatCurrencyIntl } from './format.js';
import { calculateSplit, computeAccountFlows, SPLIT_STRATEGIES } from './calculations.js';
import { INTERVALS } from './frequency.js';
import { createPeopleController } from './people.js';
import { createAccountsController } from './accounts.js';
import { createSnapshotsController } from './snapshots.js';
import { saveState, loadState, exportStateToFile, importStateFromFile } from './persistence.js';
import { refreshCategoryDatalists } from './categories.js';
import { initTheme } from './theme.js';

const ONBOARDED_KEY = 'income-shared-planner-onboarded';

const currencyCodeSelect = document.getElementById('currency-code');
const intervalSelect = document.getElementById('stats-interval');
const splitStrategySelect = document.getElementById('split-strategy');
const sharedPercentageInput = document.getElementById('shared-percentage');
const sharedPercentageControl = document.querySelector('[data-role="shared-percentage-control"]');
const strategyHint = document.querySelector('[data-role="strategy-hint"]');
const dataStatus = document.querySelector('[data-role="data-status"]');
const categoryBreakdown = document.querySelector('[data-role="category-breakdown"]');
const categoryIntervalPill = document.querySelector('[data-field="category-interval-pill"]');
const onboarding = document.querySelector('[data-role="onboarding"]');

let isRestoring = false;

function formatCurrency(amount) {
  return formatCurrencyIntl(amount, currencyCodeSelect.value);
}

function getInterval() {
  return intervalSelect.value || 'month';
}

function announceDataStatus(message) {
  if (!dataStatus) return;
  dataStatus.textContent = message;
  setTimeout(() => {
    if (dataStatus.textContent === message) dataStatus.textContent = '';
  }, 4000);
}

const peopleController = createPeopleController({
  grid: document.getElementById('people-grid'),
  template: document.getElementById('person-card-template'),
  formatCurrency,
  getInterval,
  onChange: handleChange,
});

const accountsController = createAccountsController({
  grid: document.getElementById('accounts-grid'),
  template: document.getElementById('account-card-template'),
  formatCurrency,
  getPeople: () => peopleController.people,
  getInterval,
  onChange: handleChange,
});

const snapshotsController = createSnapshotsController({
  snapshotForm: document.getElementById('snapshot-form'),
  snapshotMonthInput: document.getElementById('snapshot-month'),
  snapshotList: document.querySelector('[data-role="snapshot-list"]'),
  snapshotStatus: document.querySelector('[data-role="snapshot-status"]'),
  snapshotChart: document.getElementById('snapshot-chart'),
  chartLegend: document.querySelector('[data-role="chart-legend"]'),
  formatCurrency,
  getPeople: () => peopleController.people,
  getAllocation: () => accountsController.getLastAllocation(),
  getPrimaryAccount: () => accountsController.getPrimary(),
  getInterval,
  onChange: handleChange,
});

function updateValueState(element, amount) {
  if (!element) return;
  element.classList.remove('is-positive', 'is-negative');
  if (amount > 0.005) {
    element.classList.add('is-positive');
  } else if (amount < -0.005) {
    element.classList.add('is-negative');
  }
}

function renderCategoryBreakdown() {
  const combined = { income: {}, expense: {} };
  peopleController.people.forEach((person) => {
    ['income', 'expense'].forEach((type) => {
      Object.entries(person.metrics.byCategory[type]).forEach(([category, amount]) => {
        combined[type][category] = (combined[type][category] || 0) + amount;
      });
    });
  });

  categoryIntervalPill.textContent = INTERVALS[getInterval()]?.suffix.replace('/', 'per ') || 'per month';
  categoryBreakdown.innerHTML = '';

  ['expense', 'income'].forEach((type) => {
    const entries = Object.entries(combined[type]).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;

    const column = document.createElement('div');
    column.className = 'category-column';
    const heading = document.createElement('strong');
    heading.className = 'category-heading';
    heading.textContent = type === 'expense' ? 'Spending' : 'Income';
    column.appendChild(heading);

    const max = entries[0][1] || 1;
    entries.forEach(([category, amount]) => {
      const row = document.createElement('div');
      row.className = 'category-row';

      const label = document.createElement('span');
      label.className = 'category-label';
      label.textContent = category;

      const bar = document.createElement('span');
      bar.className = `category-bar is-${type}`;
      bar.style.width = `${Math.max(4, (amount / max) * 100)}%`;

      const value = document.createElement('span');
      value.className = 'category-value';
      value.textContent = formatCurrency(amount);

      row.append(label, bar, value);
      column.appendChild(row);
    });
    categoryBreakdown.appendChild(column);
  });

  if (!categoryBreakdown.children.length) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = 'Add some entries to see a category breakdown.';
    categoryBreakdown.appendChild(empty);
  }
}

function renderEverything() {
  const interval = getInterval();
  const people = peopleController.people;
  const strategy = splitStrategySelect.value;

  // 1. Raw income/expense per person over the selected interval.
  peopleController.renderAll();

  // 2. Account allocation rules deduct from incomes before the split.
  const flows = computeAccountFlows(people, accountsController.accounts, interval);

  // 3. Net after expenses and deductions feeds the chosen split strategy.
  const nets = people.map((person) => {
    const deductions = flows.deductionsPerPerson[person.id] || 0;
    person.metrics.deductions = deductions;
    person.metrics.net = person.metrics.income - person.metrics.expense - deductions;
    return person.metrics.net;
  });

  const allocation = calculateSplit(nets, {
    strategy,
    sharedPercentage: Number(sharedPercentageInput.value),
    customShares: people.map((person) => Number(person.customShareInput.value)),
  });
  if (SPLIT_STRATEGIES[strategy]?.usesSharedPercentage &&
      Number(sharedPercentageInput.value) !== allocation.sharePercentage) {
    sharedPercentageInput.value = allocation.sharePercentage;
  }

  // 4. Per-person allocation fields.
  people.forEach((person, index) => {
    const alloc = allocation.perPerson[index];
    person.totalsEls.deduction.textContent = formatCurrency(-person.metrics.deductions);
    updateValueState(person.totalsEls.deduction, -person.metrics.deductions);
    person.totalsEls.net.textContent = formatCurrency(person.metrics.net);
    updateValueState(person.totalsEls.net, person.metrics.net);
    person.totalsEls.share.textContent = formatCurrency(alloc.shareContribution);
    updateValueState(person.totalsEls.share, alloc.shareContribution);
    person.totalsEls.keep.textContent = formatCurrency(alloc.keep);
    updateValueState(person.totalsEls.keep, alloc.keep);
    person.totalsEls.balance.textContent = formatCurrency(alloc.balancingTransfer);
    updateValueState(person.totalsEls.balance, alloc.balancingTransfer);
  });

  // 5. Accounts, categories, snapshots.
  accountsController.renderAll(allocation, flows);
  refreshCategoryDatalists(people);
  renderCategoryBreakdown();
  snapshotsController.render();
}

function updateStrategyControls() {
  const strategy = splitStrategySelect.value;
  const config = SPLIT_STRATEGIES[strategy] || SPLIT_STRATEGIES['equal-keeps'];
  sharedPercentageControl.hidden = !config.usesSharedPercentage;
  peopleController.setCustomShareVisible(strategy === 'custom');
  strategyHint.textContent = config.description;
}

function persist() {
  if (isRestoring) return;
  saveState({
    version: 4,
    currencyCode: currencyCodeSelect.value,
    interval: getInterval(),
    split: {
      strategy: splitStrategySelect.value,
      sharedPercentage: Number(sharedPercentageInput.value) || 0,
      customShares: Object.fromEntries(
        peopleController.people.map((person) => [person.id, Number(person.customShareInput.value) || 0])
      ),
    },
    people: peopleController.people.map((person) => ({
      id: person.id,
      name: person.nameInput.value.trim(),
      entries: person.entries.map((entry) => ({ ...entry })),
      goals: person.goals.map((goal) => ({ ...goal })),
    })),
    accounts: accountsController.getState(),
    snapshots: snapshotsController.getState(),
  });
}

function handleChange() {
  renderEverything();
  persist();
}

function loadFromData(state) {
  isRestoring = true;
  try {
    peopleController.clear();
    accountsController.clear();

    if (state.currencyCode) currencyCodeSelect.value = state.currencyCode;
    if (state.interval && INTERVALS[state.interval]) intervalSelect.value = state.interval;

    const split = state.split || {};
    if (SPLIT_STRATEGIES[split.strategy]) splitStrategySelect.value = split.strategy;
    if (typeof split.sharedPercentage === 'number') sharedPercentageInput.value = split.sharedPercentage;

    const savedPeople = Array.isArray(state.people) && state.people.length > 0
      ? state.people
      : [{ name: 'Alex' }, { name: 'Jordan' }];

    savedPeople.forEach((savedPerson) => {
      peopleController.addPerson({
        id: savedPerson.id,
        name: savedPerson.name,
        customShare: split.customShares?.[savedPerson.id] ?? 0,
        goals: Array.isArray(savedPerson.goals) ? savedPerson.goals : [],
        entries: Array.isArray(savedPerson.entries)
          ? savedPerson.entries
              .map((entry) => ({
                id: entry.id,
                description: String(entry.description || '').trim(),
                amount: Math.abs(Number(entry.amount)) || 0,
                type: entry.type === 'expense' ? 'expense' : 'income',
                category: (entry.category || 'Other').trim() || 'Other',
                frequency: entry.frequency || 'monthly',
              }))
              .filter((entry) => entry.description && entry.amount > 0)
          : [],
      });
    });

    const savedAccounts = Array.isArray(state.accounts) && state.accounts.length > 0
      ? state.accounts
      : [{ id: 'shared', name: 'Shared Account', primary: true, startingBalance: 0, rules: [], directEntries: [], goals: [] }];

    savedAccounts.forEach((account) => accountsController.addAccount(account));

    snapshotsController.setState(state.snapshots);
  } finally {
    isRestoring = false;
  }
  updateStrategyControls();
  renderEverything();
}

function buildDemoState() {
  return {
    version: 4,
    currencyCode: 'GBP',
    interval: 'month',
    split: { strategy: 'equal-keeps', sharedPercentage: 30, customShares: {} },
    people: [
      {
        id: 'demo-sam',
        name: 'Sam',
        entries: [
          { id: 'd1', description: 'Salary', amount: 2400, type: 'income', category: 'Salary', frequency: 'monthly' },
          { id: 'd2', description: 'Gym', amount: 12, type: 'expense', category: 'Health', frequency: 'weekly' },
          { id: 'd3', description: 'Car insurance', amount: 540, type: 'expense', category: 'Transport', frequency: 'yearly' },
        ],
        goals: [{ id: 'dg1', name: 'New laptop', target: 1200, saved: 350 }],
      },
      {
        id: 'demo-riley',
        name: 'Riley (self-employed)',
        entries: [
          { id: 'd4', description: 'Client invoices', amount: 700, type: 'income', category: 'Freelance', frequency: 'weekly' },
          { id: 'd5', description: 'Software subscriptions', amount: 45, type: 'expense', category: 'Bills', frequency: 'monthly' },
        ],
        goals: [],
      },
    ],
    accounts: [
      {
        id: 'shared', name: 'Shared Account', primary: true, startingBalance: 1500,
        rules: [], directEntries: [{ id: 'da1', description: 'Wedding gift', amount: 200 }],
        goals: [{ id: 'ag1', name: 'Holiday fund', target: 5000 }],
      },
      {
        id: 'demo-tax', name: 'Tax set-aside', primary: false, startingBalance: 0,
        rules: [{ id: 'dr1', personId: 'demo-riley', basis: 'percent', value: 20 }],
        directEntries: [], goals: [],
      },
      {
        id: 'demo-ni', name: 'National Insurance', primary: false, startingBalance: 0,
        rules: [{ id: 'dr2', personId: 'demo-riley', basis: 'percent', value: 6 }],
        directEntries: [], goals: [],
      },
      {
        id: 'demo-pension', name: 'Pension', primary: false, startingBalance: 12000,
        rules: [{ id: 'dr3', personId: 'all', basis: 'percent', value: 5 }],
        directEntries: [], goals: [{ id: 'ag2', name: 'First £25k', target: 25000 }],
      },
    ],
    snapshots: [],
  };
}

document.getElementById('add-person').addEventListener('click', () => {
  const nextIndex = peopleController.people.length + 1;
  peopleController.addPerson({ name: `Person ${nextIndex}` });
  updateStrategyControls();
  handleChange();
});

document.getElementById('add-account').addEventListener('click', () => {
  accountsController.addAccount({ name: 'New account' });
  handleChange();
});

currencyCodeSelect.addEventListener('change', handleChange);
intervalSelect.addEventListener('change', handleChange);
sharedPercentageInput.addEventListener('input', handleChange);
splitStrategySelect.addEventListener('change', () => {
  updateStrategyControls();
  handleChange();
});

document.getElementById('export-data').addEventListener('click', () => {
  persist();
  exportStateToFile(loadState() || {});
  announceDataStatus('Backup exported.');
});

const importInput = document.getElementById('import-data');
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    const state = await importStateFromFile(file);
    loadFromData(state);
    persist();
    announceDataStatus('Backup imported.');
  } catch (error) {
    announceDataStatus(error.message || 'Import failed.');
  } finally {
    importInput.value = '';
  }
});

document.getElementById('print-snapshots').addEventListener('click', () => {
  window.print();
});

initTheme(document.getElementById('theme-toggle'));

// Redraw the canvas with the new theme's colors after a toggle.
document.getElementById('theme-toggle').addEventListener('click', () => {
  snapshotsController.redrawChart();
});

const savedState = loadState();
if (!savedState && !localStorage.getItem(ONBOARDED_KEY)) {
  onboarding.hidden = false;
}

document.getElementById('load-demo').addEventListener('click', () => {
  loadFromData(buildDemoState());
  persist();
  onboarding.hidden = true;
  localStorage.setItem(ONBOARDED_KEY, 'yes');
  announceDataStatus('Example data loaded — explore and change anything.');
});

document.getElementById('dismiss-onboarding').addEventListener('click', () => {
  onboarding.hidden = true;
  localStorage.setItem(ONBOARDED_KEY, 'yes');
});

loadFromData(savedState || {});
persist();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline support is a nice-to-have; the app works without it.
  });
}
