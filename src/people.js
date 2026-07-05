import { computeMetrics } from './calculations.js';
import { FREQUENCIES } from './frequency.js';
import { createId } from './format.js';
import { armForConfirm } from './confirm.js';
import { createGoalsView } from './goals.js';

/**
 * Manages the dynamic list of person cards: creation from a <template>,
 * per-person rendering, and add/remove/entry/goal interactions.
 */
export function createPeopleController({ grid, template, formatCurrency, getInterval, onChange }) {
  const people = [];

  function updateValueState(element, amount) {
    if (!element) return;
    element.classList.remove('is-positive', 'is-negative');
    if (amount > 0.005) {
      element.classList.add('is-positive');
    } else if (amount < -0.005) {
      element.classList.add('is-negative');
    }
  }

  function ensureEntriesPlaceholder(listElement, message) {
    if (!listElement) return;
    if (listElement.children.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'list-empty';
      emptyState.textContent = message;
      listElement.appendChild(emptyState);
    }
  }

  function showFormError(person, message) {
    if (!person.formError) return;
    person.formError.textContent = message;
    person.formError.hidden = !message;
  }

  function render(person) {
    person.metrics = computeMetrics(person.entries, getInterval());

    person.totalsEls.income.textContent = formatCurrency(person.metrics.income);
    updateValueState(person.totalsEls.income, person.metrics.income);

    person.totalsEls.expense.textContent = formatCurrency(-person.metrics.expense);
    updateValueState(person.totalsEls.expense, -person.metrics.expense);

    ['income', 'expense'].forEach((type) => {
      const listEl = person.detailLists[type];
      const panel = person.detailPanels[type];
      const toggle = person.totalCards[type];
      if (!listEl || !panel || !toggle) return;

      listEl.innerHTML = '';
      const entriesOfType = person.entries
        .filter((entry) => entry.type === type)
        .sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description));

      const hasEntries = entriesOfType.length > 0;
      if (!hasEntries) {
        if (person.detailState.open === type) {
          person.detailState.open = null;
        }
        ensureEntriesPlaceholder(listEl, type === 'income' ? 'No incoming items yet.' : 'No outgoing items yet.');
      } else {
        entriesOfType.forEach((entry) => {
          const item = document.createElement('div');
          item.className = 'detail-item';
          item.dataset.entryId = entry.id;

          const info = document.createElement('div');
          info.className = 'detail-info';

          const description = document.createElement('span');
          description.className = 'detail-description';
          description.textContent = entry.description;
          info.appendChild(description);

          const meta = document.createElement('span');
          meta.className = 'detail-meta';
          const freqLabel = (FREQUENCIES[entry.frequency] || FREQUENCIES.once).label;
          meta.textContent = `${entry.category || 'Other'} · ${freqLabel}`;
          info.appendChild(meta);

          const amount = document.createElement('span');
          amount.className = 'detail-amount';
          amount.textContent = formatCurrency(entry.type === 'expense' ? -entry.amount : entry.amount);

          const removeButton = document.createElement('button');
          removeButton.className = 'detail-remove no-print';
          removeButton.type = 'button';
          removeButton.dataset.action = 'remove-entry';
          removeButton.textContent = 'Remove';

          item.append(info, amount, removeButton);
          listEl.appendChild(item);
        });
      }

      const shouldOpen = person.detailState.open === type && hasEntries;
      toggle.disabled = !hasEntries;
      toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      panel.classList.toggle('is-open', shouldOpen);
      toggle.classList.toggle('is-open', shouldOpen);
    });

    person.goalsView.render();
  }

  function renderAll() {
    people.forEach(render);
  }

  function updateRemoveButtonVisibility() {
    const canRemove = people.length > 1;
    people.forEach((person) => {
      person.removeButton.hidden = !canRemove;
    });
  }

  function setCustomShareVisible(visible) {
    people.forEach((person) => {
      person.customShareLabel.hidden = !visible;
    });
  }

  function removePerson(person) {
    const index = people.indexOf(person);
    if (index === -1) return;
    people.splice(index, 1);
    person.card.remove();
    updateRemoveButtonVisibility();
    onChange();
  }

  function addPerson(data = {}) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.person-card');
    const nameInput = card.querySelector('.person-name');
    const removeButton = card.querySelector('[data-action="remove-person"]');
    const customShareLabel = card.querySelector('.custom-share');
    const customShareInput = card.querySelector('.custom-share-input');
    const form = card.querySelector('.entry-form');
    const typeInput = form.querySelector('input[name="type"]');
    const descriptionInput = form.querySelector('[name="description"]');
    const amountInput = form.querySelector('[name="amount"]');
    const categoryInput = form.querySelector('[name="category"]');
    const frequencySelect = form.querySelector('[name="frequency"]');
    const formError = card.querySelector('[data-role="form-error"]');

    const person = {
      id: data.id || createId(),
      card,
      nameInput,
      removeButton,
      customShareLabel,
      customShareInput,
      form,
      formError,
      typeInput,
      typeButtons: {
        income: card.querySelector('[data-entry-type="income"]'),
        expense: card.querySelector('[data-entry-type="expense"]'),
      },
      detailPanels: {
        income: card.querySelector('[data-detail-type="income"]'),
        expense: card.querySelector('[data-detail-type="expense"]'),
      },
      detailLists: {
        income: card.querySelector('[data-role="detail-income"]'),
        expense: card.querySelector('[data-role="detail-expense"]'),
      },
      totalCards: {
        income: card.querySelector('[data-total-type="income"]'),
        expense: card.querySelector('[data-total-type="expense"]'),
      },
      totalsEls: {
        income: card.querySelector('[data-field="income-total"]'),
        expense: card.querySelector('[data-field="expense-total"]'),
        deduction: card.querySelector('[data-field="deduction-total"]'),
        net: card.querySelector('[data-field="net-total"]'),
        share: card.querySelector('[data-field="share-total"]'),
        balance: card.querySelector('[data-field="balance-total"]'),
        keep: card.querySelector('[data-field="keep-total"]'),
      },
      entries: (data.entries || []).map((entry) => ({ ...entry })),
      goals: (data.goals || []).map((goal) => ({ ...goal })),
      metrics: { income: 0, expense: 0, net: 0, byCategory: { income: {}, expense: {} } },
      detailState: { open: null },
    };

    nameInput.value = data.name || '';
    customShareInput.value = String(data.customShare ?? 0);

    person.goalsView = createGoalsView({
      container: card.querySelector('[data-role="person-goals"]'),
      form: card.querySelector('[data-role="person-goal-form"]'),
      formatCurrency,
      getGoals: () => person.goals,
      getProgress: (goal) => Number(goal.saved) || 0,
      onChange,
      onSavedEdit: (goal, value) => {
        goal.saved = value;
        onChange();
      },
    });

    const ensureFocus = () => descriptionInput?.focus();

    const toggleDetail = (type) => {
      const hasItems = person.entries.some((entry) => entry.type === type);
      if (!hasItems) {
        person.detailState.open = null;
        render(person);
        return;
      }
      person.detailState.open = person.detailState.open === type ? null : type;
      render(person);
    };

    const syncCategoryList = () => {
      const type = person.typeInput?.value === 'expense' ? 'expense' : 'income';
      categoryInput.setAttribute('list', `categories-${type}`);
    };

    const handleAdd = (type) => {
      const description = (descriptionInput?.value || '').trim();
      const amountValue = parseFloat(amountInput?.value || '');

      if (!description) {
        showFormError(person, 'Please enter a description.');
        ensureFocus();
        return;
      }

      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        showFormError(person, 'Please enter an amount greater than zero.');
        amountInput?.focus();
        return;
      }

      showFormError(person, '');
      person.entries.push({
        id: createId(),
        description,
        amount: Math.abs(amountValue),
        type,
        category: (categoryInput?.value || '').trim() || 'Other',
        frequency: frequencySelect?.value || 'monthly',
      });

      person.detailState.open = type;
      const keepFrequency = frequencySelect?.value;
      person.form.reset();
      if (frequencySelect && keepFrequency) frequencySelect.value = keepFrequency;
      if (person.typeInput) person.typeInput.value = type;
      syncCategoryList();
      ensureFocus();
      onChange();
    };

    if (person.typeButtons.income) {
      person.typeButtons.income.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'income';
        syncCategoryList();
        handleAdd('income');
      });
    }
    if (person.typeButtons.expense) {
      person.typeButtons.expense.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'expense';
        syncCategoryList();
        handleAdd('expense');
      });
    }
    if (person.totalCards.income) {
      person.totalCards.income.addEventListener('click', () => toggleDetail('income'));
    }
    if (person.totalCards.expense) {
      person.totalCards.expense.addEventListener('click', () => toggleDetail('expense'));
    }

    Object.entries(person.detailLists).forEach(([typeKey, listEl]) => {
      if (!listEl) return;
      listEl.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.action === 'remove-entry') {
          const entryEl = target.closest('.detail-item');
          if (!entryEl) return;
          armForConfirm(target, {
            armedLabel: 'Confirm?',
            onConfirm: () => {
              const entryId = entryEl.dataset.entryId;
              person.entries = person.entries.filter((entry) => entry.id !== entryId);
              if (!person.entries.some((entry) => entry.type === typeKey)) {
                person.detailState.open = null;
              }
              onChange();
            },
          });
        }
      });
    });

    person.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = person.typeInput?.value === 'expense' ? 'expense' : 'income';
      handleAdd(type);
    });

    person.nameInput.addEventListener('input', () => {
      showFormError(person, '');
      onChange();
    });

    person.customShareInput.addEventListener('input', onChange);

    person.removeButton.addEventListener('click', () => {
      armForConfirm(person.removeButton, {
        armedLabel: 'Confirm remove?',
        onConfirm: () => removePerson(person),
      });
    });

    grid.appendChild(card);
    people.push(person);
    updateRemoveButtonVisibility();
    render(person);
    return person;
  }

  function clear() {
    people.splice(0, people.length).forEach((person) => person.card.remove());
  }

  return { people, addPerson, removePerson, render, renderAll, clear, setCustomShareVisible };
}
