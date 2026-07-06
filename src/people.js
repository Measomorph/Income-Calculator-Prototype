import { computeMetrics } from './calculations.js';
import { FREQUENCIES } from './frequency.js';
import { createId } from './format.js';
import { armForConfirm } from './confirm.js';
import { createGoalsView } from './goals.js';
import { PRESET_CATEGORIES } from './categories.js';
import { parseQuickEntry, buildPayeeMemory, lookupPayee, chipCategories } from './entry-smarts.js';

/**
 * Manages the dynamic list of person cards: creation from a <template>,
 * per-person rendering, and add/remove/entry/goal interactions.
 * Entry input is chip-based: description + amount + frequency, with the
 * category picked from tappable chips (recents first), payee memory that
 * re-applies a known description's tagging, and "Rent 950 monthly" parsing.
 */
export function createPeopleController({ grid, template, formatCurrency, getInterval, getGoalEta, onChange, undoable }) {
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

  function renderCategoryChips(person) {
    // One merged vocabulary: the entry type isn't known until +/- is pressed,
    // so recents from all entries come first, then expense + income presets.
    const presets = [...new Set([...PRESET_CATEGORIES.expense, ...PRESET_CATEGORIES.income])];
    const chips = chipCategories(people, presets, 'all');
    const selected = person.selectedCategory;
    person.chipRow.innerHTML = '';

    chips.forEach((category) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'category-chip';
      chip.textContent = category;
      chip.setAttribute('aria-pressed', selected === category ? 'true' : 'false');
      if (selected === category) chip.classList.add('is-selected');
      chip.addEventListener('click', () => {
        person.selectedCategory = selected === category ? null : category;
        person.customCategoryInput.hidden = true;
        person.customCategoryInput.value = '';
        renderCategoryChips(person);
      });
      person.chipRow.appendChild(chip);
    });

    const customChip = document.createElement('button');
    customChip.type = 'button';
    customChip.className = 'category-chip is-custom';
    customChip.textContent = '+ New';
    customChip.setAttribute('aria-label', 'Add a custom category');
    customChip.addEventListener('click', () => {
      person.customCategoryInput.hidden = false;
      person.customCategoryInput.focus();
    });
    person.chipRow.appendChild(customChip);
  }

  function currentCategory(person) {
    const custom = person.customCategoryInput.hidden ? '' : person.customCategoryInput.value.trim();
    return custom || person.selectedCategory || 'Other';
  }

  function buildEntryRow(person, entry, typeKey) {
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

    const actions = document.createElement('div');
    actions.className = 'detail-actions no-print';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'detail-edit';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => openEntryEditor(person, entry, item));

    const removeButton = document.createElement('button');
    removeButton.className = 'detail-remove';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      undoable(`Removed “${entry.description}”`, () => {
        person.entries = person.entries.filter((e) => e.id !== entry.id);
        if (!person.entries.some((e) => e.type === typeKey)) {
          person.detailState.open = null;
        }
      });
    });

    actions.append(editButton, removeButton);
    item.append(info, amount, actions);
    return item;
  }

  function openEntryEditor(person, entry, row) {
    const editor = document.createElement('form');
    editor.className = 'entry-editor';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.value = entry.description;
    descInput.required = true;
    descInput.setAttribute('aria-label', 'Edit description');

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.step = '0.01';
    amountInput.min = '0';
    amountInput.value = entry.amount;
    amountInput.required = true;
    amountInput.setAttribute('aria-label', 'Edit amount');

    const categoryInput = document.createElement('input');
    categoryInput.type = 'text';
    categoryInput.value = entry.category || 'Other';
    categoryInput.setAttribute('list', `categories-${entry.type}`);
    categoryInput.setAttribute('aria-label', 'Edit category');

    const freqSelect = document.createElement('select');
    freqSelect.setAttribute('aria-label', 'Edit frequency');
    Object.entries(FREQUENCIES).forEach(([value, config]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = config.label;
      if (value === entry.frequency) option.selected = true;
      freqSelect.appendChild(option);
    });

    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => onChange());

    editor.append(descInput, amountInput, categoryInput, freqSelect, save, cancel);
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const description = descInput.value.trim();
      const amount = parseFloat(amountInput.value);
      if (!description || !Number.isFinite(amount) || amount <= 0) return;
      entry.description = description;
      entry.amount = Math.abs(amount);
      entry.category = categoryInput.value.trim() || 'Other';
      entry.frequency = freqSelect.value;
      onChange();
    });

    row.replaceChildren(editor);
    descInput.focus();
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
        entriesOfType.forEach((entry) => listEl.appendChild(buildEntryRow(person, entry, type)));
      }

      const shouldOpen = person.detailState.open === type && hasEntries;
      toggle.disabled = !hasEntries;
      toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      panel.classList.toggle('is-open', shouldOpen);
      toggle.classList.toggle('is-open', shouldOpen);
    });

    renderCategoryChips(person);
    person.goalsView.render();
    person.goalsCountEl.textContent = String(person.goals.length);
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
    undoable(`Removed ${person.nameInput.value.trim() || 'person'}`, () => {
      const index = people.indexOf(person);
      if (index === -1) return;
      people.splice(index, 1);
      person.card.remove();
      updateRemoveButtonVisibility();
    });
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
      chipRow: card.querySelector('[data-role="category-chips"]'),
      customCategoryInput: card.querySelector('[name="custom-category"]'),
      selectedCategory: null,
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
      goalsCollapse: card.querySelector('[data-role="goals-collapse"]'),
      goalsCountEl: card.querySelector('[data-field="goals-count"]'),
      entries: (data.entries || []).map((entry) => ({ ...entry })),
      goals: (data.goals || []).map((goal) => ({ ...goal })),
      metrics: { income: 0, expense: 0, net: 0, byCategory: { income: {}, expense: {} } },
      detailState: { open: null },
    };

    nameInput.value = data.name || '';
    customShareInput.value = String(data.customShare ?? 0);
    person.goalsCollapse.open = person.goals.length > 0;

    person.goalsView = createGoalsView({
      container: card.querySelector('[data-role="person-goals"]'),
      form: card.querySelector('[data-role="person-goal-form"]'),
      formatCurrency,
      getGoals: () => person.goals,
      getProgress: (goal) => Number(goal.saved) || 0,
      getEta: getGoalEta ? (goal, saved) => getGoalEta({ owner: 'person', person, goal, saved }) : null,
      onChange,
      onSavedEdit: (goal, value) => {
        goal.saved = value;
        onChange();
      },
      undoable,
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

    // Payee memory: typing a known description re-applies its usual
    // category/frequency so repeat entries are one tap away.
    descriptionInput.addEventListener('input', () => {
      const memory = buildPayeeMemory(people);
      const known = lookupPayee(memory, descriptionInput.value);
      if (known) {
        person.selectedCategory = known.category;
        person.customCategoryInput.hidden = true;
        if (frequencySelect) frequencySelect.value = known.frequency;
        if (person.typeInput) person.typeInput.value = known.type;
        renderCategoryChips(person);
      }
    });

    const handleAdd = (type) => {
      let description = (descriptionInput?.value || '').trim();
      let amountValue = parseFloat(amountInput?.value || '');
      let frequency = frequencySelect?.value || 'monthly';

      // Quick-add: "Rent 950 monthly" typed straight into the description.
      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        const parsed = parseQuickEntry(description);
        if (parsed.amount) {
          description = parsed.description;
          amountValue = parsed.amount;
          if (parsed.frequency) frequency = parsed.frequency;
        }
      }

      if (!description) {
        showFormError(person, 'Please enter a description.');
        ensureFocus();
        return;
      }

      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        showFormError(person, 'Add an amount — in the amount box, or inline like “Rent 950 monthly”.');
        amountInput?.focus();
        return;
      }

      showFormError(person, '');
      person.entries.push({
        id: createId(),
        description,
        amount: Math.abs(amountValue),
        type,
        category: currentCategory(person),
        frequency,
        addedAt: new Date().toISOString(),
      });

      person.detailState.open = type;
      person.form.reset();
      person.selectedCategory = null;
      person.customCategoryInput.hidden = true;
      if (frequencySelect) frequencySelect.value = frequency;
      if (person.typeInput) person.typeInput.value = type;
      ensureFocus();
      onChange();
    };

    if (person.typeButtons.income) {
      person.typeButtons.income.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'income';
        renderCategoryChips(person);
        handleAdd('income');
      });
    }
    if (person.typeButtons.expense) {
      person.typeButtons.expense.addEventListener('click', () => {
        if (person.typeInput) person.typeInput.value = 'expense';
        renderCategoryChips(person);
        handleAdd('expense');
      });
    }
    if (person.totalCards.income) {
      person.totalCards.income.addEventListener('click', () => toggleDetail('income'));
    }
    if (person.totalCards.expense) {
      person.totalCards.expense.addEventListener('click', () => toggleDetail('expense'));
    }

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

  /** Removes one-off entries added before the current month. */
  function clearOldOneOffs() {
    const monthKey = new Date().toISOString().slice(0, 7);
    let removed = 0;
    people.forEach((person) => {
      const keep = person.entries.filter((entry) => {
        const stale = entry.frequency === 'once' && (entry.addedAt || '').slice(0, 7) < monthKey;
        if (stale) removed++;
        return !stale;
      });
      person.entries = keep;
    });
    return removed;
  }

  function countOldOneOffs() {
    const monthKey = new Date().toISOString().slice(0, 7);
    return people.reduce(
      (sum, person) => sum + person.entries.filter(
        (entry) => entry.frequency === 'once' && (entry.addedAt || '').slice(0, 7) < monthKey
      ).length,
      0
    );
  }

  return { people, addPerson, removePerson, render, renderAll, clear, setCustomShareVisible, clearOldOneOffs, countOldOneOffs };
}
