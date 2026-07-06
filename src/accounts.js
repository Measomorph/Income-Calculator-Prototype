import { createId } from './format.js';
import { FREQUENCIES, INTERVALS } from './frequency.js';
import { armForConfirm } from './confirm.js';
import { createGoalsView } from './goals.js';

/**
 * Manages the dynamic list of account cards. Each account has a starting
 * balance, allocation rules (percent-of-income, banded tax-style, or fixed
 * recurring amounts, deducted from people before the split), signed direct
 * entries (negative = withdrawal), and goals. The primary account
 * additionally receives the split contributions.
 */
export function createAccountsController({ grid, template, formatCurrency, getPeople, getInterval, getGoalEta, onChange, undoable }) {
  const accounts = [];
  let lastFlows = { accountInflows: {}, deductionsPerPerson: {}, ruleAmounts: {} };
  let lastAllocation = null;

  function ensurePlaceholder(listElement, message) {
    if (listElement.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = message;
      listElement.appendChild(empty);
    }
  }

  function describeRule(rule, people) {
    const who = rule.personId === 'all'
      ? 'everyone'
      : (people.find((p) => p.id === rule.personId)?.nameInput.value.trim() || 'former member');
    if (rule.basis === 'percent') {
      return `${rule.value}% of ${who}'s income`;
    }
    if (rule.basis === 'band') {
      const base = rule.base === 'profit' ? 'profit (after Business outgoings)' : 'income';
      return `${rule.label || 'Banded rate'} on ${who}'s ${base}`;
    }
    const freqLabel = (FREQUENCIES[rule.frequency] || FREQUENCIES.monthly).label.toLowerCase();
    return `${formatCurrency(rule.value)} ${freqLabel} from ${who}`;
  }

  function populateRulePersonSelect(account) {
    const select = account.ruleForm.querySelector('[name="rule-person"]');
    const previous = select.value;
    select.innerHTML = '';
    const everyone = document.createElement('option');
    everyone.value = 'all';
    everyone.textContent = 'Everyone';
    select.appendChild(everyone);
    getPeople().forEach((person, index) => {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.nameInput.value.trim() || `Person ${index + 1}`;
      select.appendChild(option);
    });
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  function renderAccount(account, allocation) {
    const people = getPeople();
    const interval = getInterval();
    const inflow = lastFlows.accountInflows[account.id] || 0;

    populateRulePersonSelect(account);

    account.rulesList.innerHTML = '';
    account.rules.forEach((rule) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.dataset.ruleId = rule.id;

      const main = document.createElement('div');
      main.className = 'chip-main';
      const label = document.createElement('strong');
      label.textContent = describeRule(rule, people);
      main.appendChild(label);

      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = formatCurrency(lastFlows.ruleAmounts[rule.id] || 0);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'no-print';
      remove.dataset.action = 'remove-rule';
      remove.textContent = 'Remove';

      chip.append(main, amount, remove);
      account.rulesList.appendChild(chip);
    });
    ensurePlaceholder(account.rulesList, 'No rules yet — money only arrives via direct additions.');

    const isPrimary = !!account.primary;
    account.primaryNote.hidden = !isPrimary;
    account.contributionsBlock.hidden = !isPrimary;

    let contributionTotal = 0;
    if (isPrimary && allocation) {
      contributionTotal = allocation.shareContributionTotal;
      account.contributionsList.innerHTML = '';
      allocation.perPerson.forEach((alloc, index) => {
        const person = people[index];
        if (!person) return;
        const chip = document.createElement('div');
        chip.className = 'chip';

        const main = document.createElement('div');
        main.className = 'chip-main';
        const title = document.createElement('strong');
        title.textContent = person.nameInput.value.trim() || `Person ${index + 1}`;
        main.appendChild(title);

        if (Math.abs(alloc.balancingTransfer) > 0.005) {
          const note = document.createElement('small');
          note.textContent = alloc.balancingTransfer > 0
            ? `Receives ${formatCurrency(alloc.balancingTransfer)} to balance`
            : `Supports ${formatCurrency(Math.abs(alloc.balancingTransfer))}`;
          main.appendChild(note);
        }
        if (alloc.shortfall > 0.005) {
          const note = document.createElement('small');
          note.textContent = `Short of even share by ${formatCurrency(alloc.shortfall)}`;
          main.appendChild(note);
        }

        const amount = document.createElement('span');
        amount.className = 'amount';
        amount.textContent = formatCurrency(alloc.shareContribution);

        chip.append(main, amount);
        account.contributionsList.appendChild(chip);
      });
      ensurePlaceholder(account.contributionsList, 'No contributions yet.');
      account.contributionTotalEl.textContent = formatCurrency(contributionTotal);
    }

    account.directList.innerHTML = '';
    account.directEntries.forEach((entry) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.dataset.entryId = entry.id;

      const main = document.createElement('div');
      main.className = 'chip-main';
      const label = document.createElement('strong');
      label.textContent = entry.description;
      main.appendChild(label);
      if (entry.amount < 0) {
        const note = document.createElement('small');
        note.textContent = 'Withdrawal';
        main.appendChild(note);
      }

      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = formatCurrency(entry.amount);
      if (entry.amount < 0) amount.classList.add('is-negative');

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'no-print';
      remove.dataset.action = 'remove-direct';
      remove.textContent = 'Remove';

      chip.append(main, amount, remove);
      account.directList.appendChild(chip);
    });
    ensurePlaceholder(account.directList, 'No direct additions or withdrawals yet.');

    const directTotal = account.directEntries.reduce((sum, entry) => sum + entry.amount, 0);
    account.projectedBalance = account.startingBalance + inflow + contributionTotal + directTotal;
    account.totalEl.textContent = formatCurrency(account.projectedBalance);
    account.balanceCaption.textContent = `Starting + one ${INTERVALS[interval]?.label.toLowerCase().replace('ly', '') || 'month'} of inflows`;

    account.goalsView.render();
  }

  function renderAll(allocation, flows) {
    lastAllocation = allocation;
    lastFlows = flows;
    accounts.forEach((account) => renderAccount(account, allocation));
  }

  function removeAccount(account) {
    undoable(`Removed account “${account.nameInput.value.trim() || 'account'}”`, () => {
      const index = accounts.indexOf(account);
      if (index === -1) return;
      accounts.splice(index, 1);
      account.card.remove();
    });
  }

  function addAccount(data = {}) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.account-card');

    const account = {
      id: data.id || createId(),
      primary: !!data.primary,
      card,
      nameInput: card.querySelector('.account-name'),
      removeButton: card.querySelector('[data-action="remove-account"]'),
      primaryNote: card.querySelector('[data-role="primary-note"]'),
      startingInput: card.querySelector('.account-starting'),
      rulesList: card.querySelector('[data-role="rules-list"]'),
      ruleForm: card.querySelector('[data-role="rule-form"]'),
      contributionsBlock: card.querySelector('[data-role="contributions-block"]'),
      contributionsList: card.querySelector('[data-role="contributions"]'),
      contributionTotalEl: card.querySelector('[data-field="contribution-total"]'),
      directForm: card.querySelector('[data-role="direct-form"]'),
      directList: card.querySelector('[data-role="direct-list"]'),
      totalEl: card.querySelector('[data-field="account-total"]'),
      balanceCaption: card.querySelector('[data-field="balance-caption"]'),
      startingBalance: Number(data.startingBalance) || 0,
      rules: (data.rules || []).map((rule) => ({ ...rule, id: rule.id || createId() })),
      directEntries: (data.directEntries || []).map((entry) => ({ ...entry })),
      goals: (data.goals || []).map((goal) => ({ ...goal })),
      projectedBalance: Number(data.startingBalance) || 0,
    };

    account.nameInput.value = data.name || 'New account';
    account.startingInput.value = account.startingBalance.toFixed(2);
    account.removeButton.hidden = account.primary;

    account.goalsView = createGoalsView({
      container: card.querySelector('[data-role="account-goals"]'),
      form: card.querySelector('[data-role="account-goal-form"]'),
      formatCurrency,
      getGoals: () => account.goals,
      getProgress: () => account.projectedBalance,
      getEta: getGoalEta ? (goal, saved) => getGoalEta({ owner: 'account', account, goal, saved }) : null,
      onChange,
      undoable,
    });

    account.nameInput.addEventListener('input', onChange);

    account.startingInput.addEventListener('change', () => {
      const value = parseFloat(account.startingInput.value);
      account.startingBalance = Number.isFinite(value) ? value : 0;
      account.startingInput.value = account.startingBalance.toFixed(2);
      onChange();
    });

    const basisSelect = account.ruleForm.querySelector('[name="rule-basis"]');
    const frequencySelect = account.ruleForm.querySelector('[name="rule-frequency"]');
    basisSelect.addEventListener('change', () => {
      frequencySelect.hidden = basisSelect.value !== 'fixed';
    });

    account.ruleForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(account.ruleForm);
      const value = parseFloat(data.get('rule-value'));
      if (!Number.isFinite(value) || value <= 0) return;
      account.rules.push({
        id: createId(),
        personId: data.get('rule-person') || 'all',
        basis: data.get('rule-basis') === 'fixed' ? 'fixed' : 'percent',
        value,
        frequency: data.get('rule-frequency') || 'monthly',
      });
      account.ruleForm.reset();
      frequencySelect.hidden = true;
      onChange();
    });

    account.rulesList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.action !== 'remove-rule') return;
      const ruleId = target.closest('.chip')?.dataset.ruleId;
      const rule = account.rules.find((r) => r.id === ruleId);
      if (!rule) return;
      undoable('Removed rule', () => {
        const index = account.rules.indexOf(rule);
        if (index >= 0) account.rules.splice(index, 1);
      });
    });

    const submitDirect = (sign) => {
      const data = new FormData(account.directForm);
      const description = (data.get('description') || '').toString().trim();
      const amount = Math.abs(parseFloat(data.get('amount')) || 0);
      if (!description || amount === 0) return;
      account.directEntries.push({ id: createId(), description, amount: sign * amount });
      account.directForm.reset();
      onChange();
    };

    account.directForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitDirect(1);
    });
    account.directForm.querySelector('[data-action="direct-withdraw"]').addEventListener('click', () => submitDirect(-1));

    account.directList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.action !== 'remove-direct') return;
      const entryId = target.closest('.chip')?.dataset.entryId;
      const entry = account.directEntries.find((e) => e.id === entryId);
      if (!entry) return;
      undoable(`Removed “${entry.description}”`, () => {
        const index = account.directEntries.indexOf(entry);
        if (index >= 0) account.directEntries.splice(index, 1);
      });
    });

    account.removeButton.addEventListener('click', () => {
      armForConfirm(account.removeButton, {
        armedLabel: 'Confirm remove?',
        onConfirm: () => removeAccount(account),
      });
    });

    grid.appendChild(card);
    accounts.push(account);
    return account;
  }

  function clear() {
    accounts.splice(0, accounts.length).forEach((account) => account.card.remove());
  }

  function getPrimary() {
    return accounts.find((account) => account.primary) || accounts[0] || null;
  }

  function getState() {
    return accounts.map((account) => ({
      id: account.id,
      name: account.nameInput.value.trim(),
      primary: account.primary,
      startingBalance: account.startingBalance,
      rules: account.rules.map((rule) => ({ ...rule })),
      directEntries: account.directEntries.map((entry) => ({ ...entry })),
      goals: account.goals.map((goal) => ({ ...goal })),
    }));
  }

  function getLastAllocation() {
    return lastAllocation;
  }

  return { accounts, addAccount, removeAccount, renderAll, clear, getPrimary, getState, getLastAllocation };
}
