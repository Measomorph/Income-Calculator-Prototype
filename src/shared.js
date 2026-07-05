import { calculateAllocations, computeSharedTotals } from './calculations.js';
import { createId } from './format.js';
import { armForConfirm } from './confirm.js';

export function createSharedController({
  sharedPercentageInput,
  sharedStartingInput,
  sharedForm,
  sharedFormError,
  sharedContributionList,
  sharedDirectList,
  sharedTotalField,
  sharedContributionTotal,
  sharedDirectTotal,
  sharedBaseDisplay,
  sharedBasePill,
  sharedPercentagePill,
  formatCurrency,
  onChange,
}) {
  const sharedDirectEntries = [];
  let sharedStartingBalance = 0;
  let lastAllocation = null;
  let lastTotals = { startingBalance: 0, contributionTotal: 0, directTotal: 0, total: 0 };

  function ensureEntriesPlaceholder(listElement, message) {
    if (!listElement) return;
    if (listElement.children.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'list-empty';
      emptyState.textContent = message;
      listElement.appendChild(emptyState);
    }
  }

  function updateValueState(element, amount) {
    if (!element) return;
    element.classList.remove('is-positive', 'is-negative');
    if (amount > 0.005) {
      element.classList.add('is-positive');
    } else if (amount < -0.005) {
      element.classList.add('is-negative');
    }
  }

  function render(people) {
    const allocation = calculateAllocations(
      people.map((person) => ({ net: person.metrics.net })),
      Number(sharedPercentageInput.value)
    );
    if (Number(sharedPercentageInput.value) !== allocation.sharePercentage) {
      sharedPercentageInput.value = allocation.sharePercentage;
    }
    lastAllocation = allocation;

    const { contributionTotal, directTotal, total } = computeSharedTotals(
      allocation,
      sharedStartingBalance,
      sharedDirectEntries
    );
    lastTotals = { startingBalance: sharedStartingBalance, contributionTotal, directTotal, total };

    sharedContributionList.innerHTML = '';
    allocation.perPerson.forEach((alloc, index) => {
      const person = people[index];
      const name = person.nameInput.value.trim() || `Person ${index + 1}`;

      const chip = document.createElement('div');
      chip.className = 'chip';

      const main = document.createElement('div');
      main.className = 'chip-main';

      const title = document.createElement('strong');
      title.textContent = name;
      main.appendChild(title);

      if (Math.abs(alloc.balancingTransfer) > 0.005) {
        const note = document.createElement('small');
        note.textContent = alloc.balancingTransfer > 0
          ? `Receives ${formatCurrency(alloc.balancingTransfer)} to balance`
          : `Supports ${formatCurrency(Math.abs(alloc.balancingTransfer))}`;
        main.appendChild(note);
      }

      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = formatCurrency(alloc.shareContribution);

      chip.append(main, amount);
      sharedContributionList.appendChild(chip);

      person.totalsEls.share.textContent = formatCurrency(alloc.shareContribution);
      updateValueState(person.totalsEls.share, alloc.shareContribution);

      person.totalsEls.keep.textContent = formatCurrency(alloc.keep);
      updateValueState(person.totalsEls.keep, alloc.keep);

      person.totalsEls.balance.textContent = formatCurrency(alloc.balancingTransfer);
      updateValueState(person.totalsEls.balance, alloc.balancingTransfer);
    });

    ensureEntriesPlaceholder(sharedContributionList, 'No shared contributions yet.');

    sharedContributionTotal.textContent = formatCurrency(contributionTotal);
    sharedPercentagePill.textContent = `${allocation.sharePercentage.toFixed(0)}%`;

    sharedDirectList.innerHTML = '';
    if (sharedDirectEntries.length === 0) {
      ensureEntriesPlaceholder(sharedDirectList, 'No direct additions yet.');
    } else {
      sharedDirectEntries.forEach((entry) => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.dataset.entryId = entry.id;

        const main = document.createElement('div');
        main.className = 'chip-main';
        const label = document.createElement('strong');
        label.textContent = entry.description;
        main.appendChild(label);

        const amount = document.createElement('span');
        amount.className = 'amount';
        amount.textContent = formatCurrency(entry.amount);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'no-print';
        remove.dataset.action = 'remove-direct';
        remove.textContent = 'Remove';

        chip.append(main, amount, remove);
        sharedDirectList.appendChild(chip);
      });
    }

    sharedDirectTotal.textContent = formatCurrency(directTotal);
    sharedBaseDisplay.textContent = formatCurrency(sharedStartingBalance);
    sharedBasePill.textContent = formatCurrency(sharedStartingBalance);
    sharedTotalField.textContent = formatCurrency(total);

    return allocation;
  }

  function showFormError(message) {
    if (!sharedFormError) return;
    sharedFormError.textContent = message;
    sharedFormError.hidden = !message;
  }

  sharedForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(sharedForm);
    const description = (formData.get('description') || '').toString().trim();
    const amountValue = parseFloat(formData.get('amount'));

    if (!description) {
      showFormError('Please enter a description.');
      sharedForm.querySelector('[name="description"]').focus();
      return;
    }

    const amount = Number.isFinite(amountValue) ? Math.abs(amountValue) : 0;
    if (amount === 0) {
      showFormError('Please enter an amount greater than zero.');
      sharedForm.querySelector('[name="amount"]').focus();
      return;
    }

    showFormError('');
    sharedDirectEntries.push({ id: createId(), description, amount });
    sharedForm.reset();
    sharedForm.querySelector('[name="description"]').focus();
    onChange();
  });

  sharedDirectList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === 'remove-direct') {
      armForConfirm(target, {
        armedLabel: 'Confirm?',
        onConfirm: () => {
          const entryId = target.closest('.chip')?.dataset.entryId;
          if (!entryId) return;
          const index = sharedDirectEntries.findIndex((entry) => entry.id === entryId);
          if (index >= 0) {
            sharedDirectEntries.splice(index, 1);
            onChange();
          }
        },
      });
    }
  });

  sharedStartingInput.addEventListener('change', () => {
    const value = parseFloat(sharedStartingInput.value);
    sharedStartingBalance = Number.isFinite(value) ? value : 0;
    sharedStartingInput.value = sharedStartingBalance.toFixed(2);
    onChange();
  });

  sharedPercentageInput.addEventListener('input', onChange);

  function getState() {
    return {
      startingBalance: sharedStartingBalance,
      directEntries: sharedDirectEntries.map((entry) => ({ ...entry })),
    };
  }

  function setState(state) {
    sharedStartingBalance = Number(state?.startingBalance) || 0;
    sharedStartingInput.value = sharedStartingBalance.toFixed(2);

    sharedDirectEntries.splice(0, sharedDirectEntries.length);
    if (Array.isArray(state?.directEntries)) {
      sharedDirectEntries.push(
        ...state.directEntries
          .map((entry) => ({
            id: entry.id || createId(),
            description: String(entry.description || '').trim(),
            amount: Math.abs(Number(entry.amount)) || 0,
          }))
          .filter((entry) => entry.description && entry.amount > 0)
      );
    }
  }

  function getLastAllocation() {
    return lastAllocation;
  }

  function getTotals() {
    return lastTotals;
  }

  return { render, getState, setState, getLastAllocation, getTotals };
}
