import { formatCurrency as formatCurrencyIntl, createId } from './format.js';
import { calculateSplit, computeAccountFlows, computeMonthlyOutlook, monthsToTarget, SPLIT_STRATEGIES, UK_TAX_PRESETS } from './calculations.js';
import { INTERVALS } from './frequency.js';
import { createPeopleController } from './people.js';
import { createAccountsController } from './accounts.js';
import { createSnapshotsController } from './snapshots.js';
import { saveState, loadState, normalizeImportedState } from './persistence.js';
import { encryptState, decryptState, isEncryptedEnvelope } from './crypto.js';
import { parseCSV, guessColumns, parseStatementAmount } from './csv.js';
import { buildPayeeMemory, lookupPayee } from './entry-smarts.js';
import { refreshCategoryDatalists } from './categories.js';
import { showToast } from './toast.js';
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
const projectionTable = document.querySelector('[data-role="projection-table"]');
const clearOneOffsButton = document.getElementById('clear-oneoffs');
const scenarioSelect = document.getElementById('scenario-select');
const scenarioBanner = document.querySelector('[data-role="scenario-banner"]');
const scenarioCompare = document.querySelector('[data-role="scenario-compare"]');
const deleteScenarioButton = document.getElementById('delete-scenario');

let isRestoring = false;
let scenarios = [];
let activeScenarioId = null;
let livePayloadCache = null;
let lastMonthlyOutlook = { rates: {}, keeps: {} };

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

function etaLabel(saved, target, monthlyRate) {
  const months = monthsToTarget(saved, Number(target) || 0, monthlyRate);
  if (months === 0) return 'Target reached 🎉';
  if (months === null || months > 600) return null;
  const eta = new Date();
  eta.setMonth(eta.getMonth() + months);
  const label = eta.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return `≈ ${label} at current rate (${months} month${months === 1 ? '' : 's'})`;
}

function getGoalEta({ owner, account, person, goal, saved }) {
  if (owner === 'account') return etaLabel(saved, goal.target, lastMonthlyOutlook.rates[account.id] || 0);
  return etaLabel(saved, goal.target, lastMonthlyOutlook.keeps[person.id] || 0);
}

/**
 * Wraps a mutation so it can be undone from a toast: captures the current
 * payload, applies the change, and restores the capture on Undo.
 */
function undoable(label, mutate) {
  const before = buildPayload();
  mutate();
  renderEverything();
  persist();
  showToast(label, {
    onUndo: () => {
      loadFromData(before);
      persist();
    },
  });
}

const peopleController = createPeopleController({
  grid: document.getElementById('people-grid'),
  template: document.getElementById('person-card-template'),
  formatCurrency,
  getInterval,
  getGoalEta,
  onChange: handleChange,
  undoable,
});

const accountsController = createAccountsController({
  grid: document.getElementById('accounts-grid'),
  template: document.getElementById('account-card-template'),
  formatCurrency,
  getPeople: () => peopleController.people,
  getInterval,
  getGoalEta,
  onChange: handleChange,
  undoable,
});

const snapshotsController = createSnapshotsController({
  snapshotForm: document.getElementById('snapshot-form'),
  snapshotMonthInput: document.getElementById('snapshot-month'),
  snapshotList: document.querySelector('[data-role="snapshot-list"]'),
  snapshotStatus: document.querySelector('[data-role="snapshot-status"]'),
  snapshotChart: document.getElementById('snapshot-chart'),
  chartLegend: document.querySelector('[data-role="chart-legend"]'),
  trendsChart: document.getElementById('category-trend-chart'),
  trendsLegend: document.querySelector('[data-role="trends-legend"]'),
  formatCurrency,
  getPeople: () => peopleController.people,
  getAllocation: () => accountsController.getLastAllocation(),
  getPrimaryAccount: () => accountsController.getPrimary(),
  getInterval,
  onChange: handleChange,
  undoable,
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

function renderProjection() {
  projectionTable.innerHTML = '';
  const horizons = [3, 6, 12];

  const header = document.createElement('div');
  header.className = 'projection-row is-header';
  header.append(...['Account', 'Now', ...horizons.map((m) => `+${m} mo`)].map((text) => {
    const cell = document.createElement('span');
    cell.textContent = text;
    return cell;
  }));
  projectionTable.appendChild(header);

  accountsController.accounts.forEach((account) => {
    const rate = lastMonthlyOutlook.rates[account.id] || 0;
    const row = document.createElement('div');
    row.className = 'projection-row';
    const cells = [
      account.nameInput.value.trim() || 'Account',
      formatCurrency(account.projectedBalance),
      ...horizons.map((m) => formatCurrency(account.projectedBalance + rate * m)),
    ];
    cells.forEach((text, index) => {
      const cell = document.createElement('span');
      cell.textContent = text;
      if (index === 0) cell.className = 'projection-name';
      row.appendChild(cell);
    });
    projectionTable.appendChild(row);
  });
}

function updateClearOneOffsButton() {
  const count = peopleController.countOldOneOffs();
  clearOneOffsButton.hidden = count === 0;
  clearOneOffsButton.textContent = `Clear ${count} old one-off${count === 1 ? '' : 's'}`;
}

function renderScenarioControls() {
  scenarioSelect.innerHTML = '';
  const live = document.createElement('option');
  live.value = '';
  live.textContent = 'Live';
  scenarioSelect.appendChild(live);
  scenarios.forEach((scenario) => {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.name;
    scenarioSelect.appendChild(option);
  });
  scenarioSelect.value = activeScenarioId || '';
  deleteScenarioButton.hidden = !activeScenarioId;
  scenarioBanner.hidden = !activeScenarioId;
}

function renderScenarioCompare() {
  if (!activeScenarioId || !livePayloadCache) {
    scenarioCompare.textContent = '';
    return;
  }
  // Same raw monthly-net basis on both sides so the delta is meaningful.
  const liveNet = summarizePayloadNet(livePayloadCache);
  const currentNet = summarizePayloadNet(buildPayload());
  const delta = currentNet - liveNet;
  const sign = delta >= 0 ? '+' : '−';
  scenarioCompare.textContent = ` Combined net here: ${formatCurrency(currentNet)} (${sign}${formatCurrency(Math.abs(delta)).replace(/^-/, '')} vs live).`;
}

/** Rough combined-net figure for a stored payload, for scenario comparison. */
function summarizePayloadNet(payload) {
  let net = 0;
  (payload.people || []).forEach((person) => {
    (person.entries || []).forEach((entry) => {
      const yearlyFactors = { once: 0, daily: 365, weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };
      const perYear = yearlyFactors[entry.frequency] ?? 12;
      const monthly = perYear === 0 ? entry.amount : (entry.amount * perYear) / 12;
      net += entry.type === 'expense' ? -monthly : monthly;
    });
  });
  return net;
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

  // 5. Steady-state monthly rates power projections and goal ETAs.
  lastMonthlyOutlook = computeMonthlyOutlook(
    people.map((person) => ({ id: person.id, entries: person.entries })),
    accountsController.accounts,
    {
      strategy,
      sharedPercentage: Number(sharedPercentageInput.value),
      customShares: people.map((person) => Number(person.customShareInput.value)),
    }
  );

  // 6. Accounts, categories, projection, snapshots, scenario chrome.
  accountsController.renderAll(allocation, flows);
  refreshCategoryDatalists(people);
  renderCategoryBreakdown();
  renderProjection();
  updateClearOneOffsButton();
  snapshotsController.render();
  renderScenarioCompare();
}

function updateStrategyControls() {
  const strategy = splitStrategySelect.value;
  const config = SPLIT_STRATEGIES[strategy] || SPLIT_STRATEGIES['equal-keeps'];
  sharedPercentageControl.hidden = !config.usesSharedPercentage;
  peopleController.setCustomShareVisible(strategy === 'custom');
  strategyHint.textContent = config.description;
}

function buildPayload() {
  return {
    version: 5,
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
  };
}

function persist() {
  if (isRestoring) return;
  const payload = buildPayload();
  if (activeScenarioId) {
    const scenario = scenarios.find((s) => s.id === activeScenarioId);
    if (scenario) scenario.state = payload;
    saveState({ ...(livePayloadCache || payload), scenarios });
  } else {
    livePayloadCache = payload;
    saveState({ ...payload, scenarios });
  }
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
                addedAt: entry.addedAt || new Date().toISOString(),
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

// --- Dialog helpers ---

function openDialog(dialog, setup) {
  return new Promise((resolve) => {
    if (setup) setup();
    const form = dialog.querySelector('form');
    const done = (value) => {
      dialog.close();
      cleanup();
      resolve(value);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      done(new FormData(form));
    };
    const onCancel = () => done(null);
    const cancelButton = dialog.querySelector('[data-action="cancel"]');
    const onDialogCancel = () => done(null);
    function cleanup() {
      form.removeEventListener('submit', onSubmit);
      cancelButton?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
      form.reset();
    }
    form.addEventListener('submit', onSubmit);
    cancelButton?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    dialog.showModal();
  });
}

const passphraseDialog = document.getElementById('passphrase-dialog');

async function askPassphrase(title, hint) {
  const result = await openDialog(passphraseDialog, () => {
    passphraseDialog.querySelector('[data-role="passphrase-title"]').textContent = title;
    passphraseDialog.querySelector('[data-role="passphrase-hint"]').textContent = hint;
  });
  if (result === null) return null;
  return (result.get('passphrase') || '').toString();
}

// --- Export / import ---

document.getElementById('export-data').addEventListener('click', async () => {
  persist();
  const payload = { ...buildPayload(), scenarios };
  const passphrase = await askPassphrase(
    'Export backup',
    'Optional: add a passphrase to encrypt the file. Leave blank to export unencrypted. There is no recovery if you forget it.'
  );
  if (passphrase === null) return;
  const output = passphrase.trim() ? await encryptState(payload, passphrase) : payload;
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budget-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  announceDataStatus(passphrase.trim() ? 'Encrypted backup exported.' : 'Backup exported.');
});

const importInput = document.getElementById('import-data');
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    let parsed = JSON.parse(await file.text());
    if (isEncryptedEnvelope(parsed)) {
      const passphrase = await askPassphrase('Encrypted backup', 'This backup is encrypted. Enter its passphrase to import.');
      if (passphrase === null) return;
      parsed = await decryptState(parsed, passphrase);
    }
    const state = normalizeImportedState(parsed);
    if (!state) throw new Error('File does not contain a valid backup.');
    scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
    activeScenarioId = null;
    livePayloadCache = null;
    loadFromData(state);
    renderScenarioControls();
    persist();
    announceDataStatus('Backup imported.');
  } catch (error) {
    announceDataStatus(error.message || 'Import failed.');
  } finally {
    importInput.value = '';
  }
});

// --- CSV import ---

const csvDialog = document.getElementById('csv-dialog');
const csvInput = document.getElementById('import-csv');

csvInput.addEventListener('change', async () => {
  const file = csvInput.files?.[0];
  csvInput.value = '';
  if (!file) return;

  const rows = parseCSV(await file.text());
  if (rows.length < 2) {
    announceDataStatus('CSV needs a header row and at least one data row.');
    return;
  }
  const header = rows[0];
  const dataRows = rows.slice(1);
  const guesses = guessColumns(header);

  const result = await openDialog(csvDialog, () => {
    const descSelect = csvDialog.querySelector('[name="csv-description"]');
    const amountSelect = csvDialog.querySelector('[name="csv-amount"]');
    [descSelect, amountSelect].forEach((select) => {
      select.innerHTML = '';
      header.forEach((cell, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = cell || `Column ${index + 1}`;
        select.appendChild(option);
      });
    });
    if (guesses.description >= 0) descSelect.value = String(guesses.description);
    if (guesses.amount >= 0) amountSelect.value = String(guesses.amount);

    const personSelect = csvDialog.querySelector('[name="csv-person"]');
    personSelect.innerHTML = '';
    peopleController.people.forEach((person, index) => {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.nameInput.value.trim() || `Person ${index + 1}`;
      personSelect.appendChild(option);
    });

    csvDialog.querySelector('[data-role="csv-count"]').textContent = String(dataRows.length);
    const preview = csvDialog.querySelector('[data-role="csv-preview"]');
    preview.innerHTML = '';
    const table = document.createElement('table');
    [header, ...dataRows.slice(0, 5)].forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const el = document.createElement(rowIndex === 0 ? 'th' : 'td');
        el.textContent = cell.length > 28 ? `${cell.slice(0, 28)}…` : cell;
        tr.appendChild(el);
      });
      table.appendChild(tr);
    });
    preview.appendChild(table);
  });

  if (!result) return;

  const descIndex = Number(result.get('csv-description'));
  const amountIndex = Number(result.get('csv-amount'));
  const personId = result.get('csv-person');
  const negativeMeans = result.get('csv-sign');
  const person = peopleController.people.find((p) => p.id === personId);
  if (!person) return;

  const memory = buildPayeeMemory(peopleController.people);
  let imported = 0;
  let skipped = 0;
  const newEntries = [];

  dataRows.forEach((row) => {
    const description = (row[descIndex] || '').trim();
    const amount = parseStatementAmount(row[amountIndex]);
    if (!description || !Number.isFinite(amount) || amount === 0) {
      skipped++;
      return;
    }
    const isNegative = amount < 0;
    const type = isNegative
      ? (negativeMeans === 'income' ? 'income' : 'expense')
      : (negativeMeans === 'income' ? 'expense' : 'income');
    const known = lookupPayee(memory, description);
    newEntries.push({
      id: createId(),
      description,
      amount: Math.abs(amount),
      type,
      category: known?.category || 'Other',
      frequency: 'once',
      addedAt: new Date().toISOString(),
    });
    imported++;
  });

  if (!imported) {
    announceDataStatus('No usable rows found in that CSV.');
    return;
  }

  undoable(`Imported ${imported} rows${skipped ? ` (${skipped} skipped)` : ''}`, () => {
    person.entries.push(...newEntries);
  });
});

// --- Scenarios ---

const scenarioDialog = document.getElementById('scenario-dialog');

document.getElementById('save-scenario').addEventListener('click', async () => {
  const result = await openDialog(scenarioDialog);
  if (!result) return;
  const name = (result.get('scenario-name') || '').toString().trim();
  if (!name) return;
  persist();
  const scenario = { id: createId(), name, state: buildPayload(), createdAt: new Date().toISOString() };
  scenarios.push(scenario);
  if (!activeScenarioId) livePayloadCache = buildPayload();
  activeScenarioId = scenario.id;
  renderScenarioControls();
  renderScenarioCompare();
  persist();
  announceDataStatus(`Scenario “${name}” created — you're now sandboxing.`);
});

scenarioSelect.addEventListener('change', () => {
  const targetId = scenarioSelect.value || null;
  persist();
  if (targetId === activeScenarioId) return;

  if (targetId) {
    if (!activeScenarioId) livePayloadCache = buildPayload();
    const scenario = scenarios.find((s) => s.id === targetId);
    if (!scenario) return;
    activeScenarioId = targetId;
    loadFromData(scenario.state);
  } else {
    activeScenarioId = null;
    if (livePayloadCache) loadFromData(livePayloadCache);
  }
  renderScenarioControls();
  persist();
});

deleteScenarioButton.addEventListener('click', () => {
  const scenario = scenarios.find((s) => s.id === activeScenarioId);
  if (!scenario) return;
  undoable(`Deleted scenario “${scenario.name}”`, () => {
    scenarios = scenarios.filter((s) => s.id !== scenario.id);
    activeScenarioId = null;
    if (livePayloadCache) loadFromData(livePayloadCache);
    renderScenarioControls();
  });
});

// --- UK tax preset ---

document.getElementById('uk-tax-preset').addEventListener('click', () => {
  const people = peopleController.people;
  const targetPerson = people.length === 1 ? people[0] : null;
  const apply = (person) => {
    const personId = person.id;
    accountsController.addAccount({
      name: UK_TAX_PRESETS.incomeTax.name,
      rules: [{ id: createId(), personId, basis: 'band', bands: UK_TAX_PRESETS.incomeTax.bands, label: 'UK Income Tax bands 2025/26' }],
    });
    accountsController.addAccount({
      name: UK_TAX_PRESETS.class4Ni.name,
      rules: [{ id: createId(), personId, basis: 'band', bands: UK_TAX_PRESETS.class4Ni.bands, label: 'Class 4 NI bands 2025/26' }],
    });
    handleChange();
    announceDataStatus(`Tax and NI pots added for ${person.nameInput.value.trim() || 'person'} (estimates, not tax advice).`);
  };

  if (targetPerson) {
    apply(targetPerson);
    return;
  }

  // More than one person: build a quick chooser dialog on the fly.
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h3');
  title.textContent = 'Whose income is self-employed?';
  const select = document.createElement('select');
  people.forEach((person, index) => {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.nameInput.value.trim() || `Person ${index + 1}`;
    select.appendChild(option);
  });
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.textContent = 'Add tax pots';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.close());
  actions.append(ok, cancel);
  form.append(title, select, actions);
  form.addEventListener('submit', () => {
    const person = people.find((p) => p.id === select.value);
    dialog.close();
    if (person) apply(person);
  });
  dialog.appendChild(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
});

// --- One-off housekeeping ---

clearOneOffsButton.addEventListener('click', () => {
  const count = peopleController.countOldOneOffs();
  if (!count) return;
  undoable(`Cleared ${count} old one-off${count === 1 ? '' : 's'}`, () => {
    peopleController.clearOldOneOffs();
  });
});

// --- Global controls ---

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

document.getElementById('print-snapshots').addEventListener('click', () => {
  window.print();
});

initTheme(document.getElementById('theme-toggle'));
document.getElementById('theme-toggle').addEventListener('click', () => {
  snapshotsController.redrawChart();
});

// --- Demo data & boot ---

function buildDemoState() {
  return {
    version: 5,
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
        id: 'demo-pension', name: 'Pension', primary: false, startingBalance: 12000,
        rules: [{ id: 'dr3', personId: 'all', basis: 'percent', value: 5 }],
        directEntries: [], goals: [{ id: 'ag2', name: 'First £25k', target: 25000 }],
      },
    ],
    snapshots: [],
  };
}

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

scenarios = Array.isArray(savedState?.scenarios) ? savedState.scenarios : [];
renderScenarioControls();
loadFromData(savedState || {});
persist();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline support is a nice-to-have; the app works without it.
  });
}
