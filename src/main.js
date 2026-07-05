import { formatCurrency as formatCurrencyIntl } from './format.js';
import { createPeopleController } from './people.js';
import { createSharedController } from './shared.js';
import { createSnapshotsController } from './snapshots.js';
import { saveState, loadState, exportStateToFile, importStateFromFile } from './persistence.js';
import { initTheme } from './theme.js';

const currencyCodeSelect = document.getElementById('currency-code');
const sharedPercentageInput = document.getElementById('shared-percentage');
const dataStatus = document.querySelector('[data-role="data-status"]');

let isRestoring = false;

function formatCurrency(amount) {
  return formatCurrencyIntl(amount, currencyCodeSelect.value);
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
  onChange: handleChange,
});

const sharedController = createSharedController({
  sharedPercentageInput,
  sharedStartingInput: document.getElementById('shared-starting-balance'),
  sharedForm: document.getElementById('shared-direct-form'),
  sharedFormError: document.querySelector('[data-role="shared-form-error"]'),
  sharedContributionList: document.querySelector('[data-role="shared-contributions"]'),
  sharedDirectList: document.querySelector('[data-role="shared-direct"]'),
  sharedTotalField: document.querySelector('[data-field="shared-total"]'),
  sharedContributionTotal: document.querySelector('[data-field="shared-contribution-total"]'),
  sharedDirectTotal: document.querySelector('[data-field="shared-direct-total"]'),
  sharedBaseDisplay: document.querySelector('[data-field="shared-base-display"]'),
  sharedBasePill: document.querySelector('[data-field="shared-base-pill"]'),
  sharedPercentagePill: document.querySelector('[data-field="shared-percentage-pill"]'),
  formatCurrency,
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
  getSharedAllocation: () => sharedController.getLastAllocation(),
  getSharedTotals: () => sharedController.getTotals(),
  onChange: handleChange,
});

function renderEverything() {
  peopleController.renderAll();
  sharedController.render(peopleController.people);
  snapshotsController.render();
}

function persist() {
  if (isRestoring) return;
  saveState({
    currencyCode: currencyCodeSelect.value,
    sharedPercentage: Number(sharedPercentageInput.value) || 0,
    people: peopleController.people.map((person) => ({
      id: person.id,
      name: person.nameInput.value.trim(),
      entries: person.entries.map((entry) => ({ ...entry })),
    })),
    shared: sharedController.getState(),
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

    if (state.currencyCode) {
      currencyCodeSelect.value = state.currencyCode;
    }

    if (typeof state.sharedPercentage === 'number') {
      sharedPercentageInput.value = state.sharedPercentage;
    }

    const savedPeople = Array.isArray(state.people) && state.people.length > 0
      ? state.people
      : [{ name: 'Alex' }, { name: 'Jordan' }];

    savedPeople.forEach((savedPerson) => {
      peopleController.addPerson({
        id: savedPerson.id,
        name: savedPerson.name,
        entries: Array.isArray(savedPerson.entries)
          ? savedPerson.entries
              .map((entry) => ({
                id: entry.id,
                description: String(entry.description || '').trim(),
                amount: Math.abs(Number(entry.amount)) || 0,
                type: entry.type === 'expense' ? 'expense' : 'income',
              }))
              .filter((entry) => entry.description && entry.amount > 0)
          : [],
      });
    });

    sharedController.setState(state.shared);
    snapshotsController.setState(state.snapshots);
  } finally {
    isRestoring = false;
  }
  renderEverything();
}

document.getElementById('add-person').addEventListener('click', () => {
  const nextIndex = peopleController.people.length + 1;
  peopleController.addPerson({ name: `Person ${nextIndex}` });
  handleChange();
});

currencyCodeSelect.addEventListener('change', handleChange);

document.getElementById('export-data').addEventListener('click', () => {
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

loadFromData(loadState() || {});
persist();
