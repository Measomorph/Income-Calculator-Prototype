import { computeMetrics } from './calculations.js';
import { createId } from './format.js';
import { armForConfirm } from './confirm.js';

/**
 * Manages the dynamic list of person cards: creation from a <template>,
 * per-person rendering, and add/remove/entry interactions.
 */
export function createPeopleController({ grid, template, formatCurrency, onChange }) {
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
    person.metrics = computeMetrics(person.entries);

    person.totalsEls.income.textContent = formatCurrency(person.metrics.income);
    updateValueState(person.totalsEls.income, person.metrics.income);

    person.totalsEls.expense.textContent = formatCurrency(-person.metrics.expense);
    updateValueState(person.totalsEls.expense, -person.metrics.expense);

    person.totalsEls.net.textContent = formatCurrency(person.metrics.net);
    updateValueState(person.totalsEls.net, person.metrics.net);

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

          const description = document.createElement('span');
          description.className = 'detail-description';
          description.textContent = entry.description;

          const amount = document.createElement('span');
          amount.className = 'detail-amount';
          amount.textContent = formatCurrency(entry.type === 'expense' ? -entry.amount : entry.amount);

          const removeButton = document.createElement('button');
          removeButton.className = 'detail-remove no-print';
          removeButton.type = 'button';
          removeButton.dataset.action = 'remove-entry';
          removeButton.textContent = 'Remove';

          item.append(description, amount, removeButton);
          listEl.appendChild(item);
        });
      }

      const shouldOpen = person.detailState.open === type && hasEntries;
      toggle.disabled = !hasEntries;
      toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      panel.classList.toggle('is-open', shouldOpen);
      toggle.classList.toggle('is-open', shouldOpen);
    });
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
    const form = card.querySelector('.entry-form');
    const typeInput = form.querySelector('input[name="type"]');
    const descriptionInput = form.querySelector('[name="description"]');
    const amountInput = form.querySelector('[name="amount"]');
    const formError = card.querySelector('[data-role="form-error"]');

    const person = {
      id: data.id || createId(),
      card,
      nameInput,
      removeButton,
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
        net: card.querySelector('[data-field="net-total"]'),
        share: card.querySelector('[data-field="share-total"]'),
        balance: card.querySelector('[data-field="balance-total"]'),
        keep: card.querySelector('[data-field="keep-total"]'),
      },
      entries: (data.entries || []).map((entry) => ({ ...entry })),
      metrics: { income: 0, expense: 0, net: 0 },
      detailState: { open: null },
    };

    nameInput.value = data.name || '';

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
      });

      person.detailState.open = type;
      person.form.reset();
      if (person.typeInput) person.typeInput.value = type;
      ensureFocus();
      render(person);
      onChange();
    };

    if (person.typeButtons.income) {
      person.typeButtons.income.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'income';
        handleAdd('income');
      });
    }
    if (person.typeButtons.expense) {
      person.typeButtons.expense.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'expense';
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
              render(person);
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

  return { people, addPerson, removePerson, render, renderAll, clear };
}
