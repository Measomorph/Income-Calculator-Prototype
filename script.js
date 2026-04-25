(function () {
  const storageKey = 'income-shared-planner-v2';
  const currencyInput = document.getElementById('currency-symbol');
  const sharedPercentageInput = document.getElementById('shared-percentage');
  const addAccountForm = document.getElementById('add-account-form');
  const accountsGrid = document.getElementById('accounts-grid');
  const accountDirectForm = document.getElementById('account-direct-form');
  const directAccountSelect = document.getElementById('direct-account-select');
  const snapshotForm = document.getElementById('snapshot-form');
  const snapshotMonthInput = document.getElementById('snapshot-month');
  const snapshotList = document.querySelector('[data-role="snapshot-list"]');
  const snapshotStatus = document.querySelector('[data-role="snapshot-status"]');
  const snapshotChart = document.getElementById('snapshot-chart');

  const accounts = [];
  let isRestoring = false;
  let lastSnapshotChartData = [];
  let lastAllocation = null;

  const people = Array.from(document.querySelectorAll('.person-card')).map((card, index) => {
    const nameInput = card.querySelector('.person-name');
    const form = card.querySelector('.entry-form');
    const typeInput = form.querySelector('input[name="type"]');

    const typeButtons = {
      income: card.querySelector('[data-entry-type="income"]'),
      expense: card.querySelector('[data-entry-type="expense"]'),
    };

    const detailPanels = {
      income: card.querySelector('[data-detail-type="income"]'),
      expense: card.querySelector('[data-detail-type="expense"]'),
    };

    const detailLists = {
      income: card.querySelector('[data-role="detail-income"]'),
      expense: card.querySelector('[data-role="detail-expense"]'),
    };

    const totalCards = {
      income: card.querySelector('[data-total-type="income"]'),
      expense: card.querySelector('[data-total-type="expense"]'),
    };

    const totals = {
      income: card.querySelector('[data-field="income-total"]'),
      expense: card.querySelector('[data-field="expense-total"]'),
      net: card.querySelector('[data-field="net-total"]'),
      share: card.querySelector('[data-field="share-total"]'),
      balance: card.querySelector('[data-field="balance-total"]'),
      keep: card.querySelector('[data-field="keep-total"]'),
    };

    return {
      id: card.dataset.person || ('person-' + (index + 1)),
      index,
      card,
      nameInput,
      form,
      typeInput,
      typeButtons,
      detailPanels,
      detailLists,
      totalCards,
      totalsEls: totals,
      entries: [],
      metrics: { income: 0, expense: 0, net: 0 },
      detailState: { open: null },
    };
  });

  function clampPercentage(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatCurrency(amount) {
    const symbol = (currencyInput.value || '£').trim() || '£';
    const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    const absolute = Math.abs(safeAmount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return `${safeAmount < 0 ? '-' : ''}${symbol}${absolute}`;
  }

  function computeMetrics(person) {
    const income = person.entries
      .filter((entry) => entry.type === 'income')
      .reduce((sum, entry) => sum + entry.amount, 0);

    const expense = person.entries
      .filter((entry) => entry.type === 'expense')
      .reduce((sum, entry) => sum + entry.amount, 0);

    const net = income - expense;
    person.metrics = { income, expense, net };
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

  function ensureEntriesPlaceholder(listElement, message) {
    if (!listElement) return;
    if (listElement.children.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'list-empty';
      emptyState.textContent = message;
      listElement.appendChild(emptyState);
    }
  }

  function enterDetailEditMode(entryEl, person, entryId) {
    const entry = person.entries.find((item) => item.id === entryId);
    if (!entry) return;

    entryEl.innerHTML = '';
    entryEl.classList.add('detail-editing');

    const descriptionInput = document.createElement('input');
    descriptionInput.className = 'detail-edit-input';
    descriptionInput.type = 'text';
    descriptionInput.value = entry.description;
    descriptionInput.placeholder = 'Description';

    const amountInput = document.createElement('input');
    amountInput.className = 'detail-edit-input';
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = '0.01';
    amountInput.value = entry.amount.toFixed(2);
    amountInput.placeholder = 'Amount';

    const actions = document.createElement('div');
    actions.className = 'detail-edit-actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'detail-edit-save';
    saveButton.dataset.action = 'save-entry';
    saveButton.textContent = 'Save';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'detail-edit-cancel';
    cancelButton.dataset.action = 'cancel-edit';
    cancelButton.textContent = 'Cancel';

    actions.append(saveButton, cancelButton);
    entryEl.append(descriptionInput, amountInput, actions);
    descriptionInput.focus();
  }

  function saveDetailEntry(entryEl, person, entryId) {
    const entry = person.entries.find((item) => item.id === entryId);
    if (!entry) return;

    const descriptionInput = entryEl.querySelector('input[type="text"]');
    const amountInput = entryEl.querySelector('input[type="number"]');
    const description = (descriptionInput?.value || '').trim();
    const amountValue = parseFloat(amountInput?.value || '');

    if (!description) {
      descriptionInput?.focus();
      return;
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      amountInput?.focus();
      return;
    }

    entry.description = description;
    entry.amount = Math.abs(amountValue);
    renderPerson(person);
    renderSharedSummary();
    persistState();
  }

  function renderPerson(person) {
    computeMetrics(person);

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

          const editButton = document.createElement('button');
          editButton.className = 'detail-edit';
          editButton.type = 'button';
          editButton.dataset.action = 'edit-entry';
          editButton.textContent = 'Edit';

          const removeButton = document.createElement('button');
          removeButton.className = 'detail-remove';
          removeButton.type = 'button';
          removeButton.dataset.action = 'remove-entry';
          removeButton.textContent = 'Remove';

          item.append(description, amount, editButton, removeButton);
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

  function calculateAllocations() {
    const rawPercentage = Number(sharedPercentageInput.value);
    const sharePercentage = clampPercentage(Number.isFinite(rawPercentage) ? rawPercentage : 0);
    if (Number(sharedPercentageInput.value) !== sharePercentage) {
      sharedPercentageInput.value = sharePercentage;
    }

    const combinedNet = people.reduce((sum, person) => sum + person.metrics.net, 0);
    const positiveCombinedNet = combinedNet > 0 ? combinedNet : 0;
    const desiredShareTarget = (positiveCombinedNet * sharePercentage) / 100;
    const keepPool = combinedNet - desiredShareTarget;
    const keepPerPerson = people.length > 0 ? keepPool / people.length : 0;

    const perPerson = people.map((person) => {
      const rawContribution = person.metrics.net - keepPerPerson;
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

    const totalAllocPercent = accounts.reduce((sum, a) => sum + a.allocationPercentage, 0);
    const accountContributions = accounts.map(account => {
      const percent = totalAllocPercent > 0 ? account.allocationPercentage / totalAllocPercent : 0;
      const amount = percent * shareContributionTotal;
      return { accountId: account.id, amount };
    });

    return {
      sharePercentage,
      combinedNet,
      keepPerPerson,
      shareContributionTotal,
      perPerson,
      accountContributions,
    };
  }

  function computeSharedTotals(allocation) {
    const contributionTotal = allocation?.shareContributionTotal || 0;
    const directTotal = sharedDirectEntries.reduce((sum, entry) => sum + entry.amount, 0);
    const total = sharedStartingBalance + contributionTotal + directTotal;
    return { contributionTotal, directTotal, total };
  }

  function renderSharedSummary() {
    const allocation = calculateAllocations();
    lastAllocation = allocation;

    allocation.perPerson.forEach((alloc, index) => {
      const person = people[index];
      person.totalsEls.share.textContent = formatCurrency(alloc.shareContribution);
      updateValueState(person.totalsEls.share, alloc.shareContribution);

      person.totalsEls.keep.textContent = formatCurrency(alloc.keep);
      updateValueState(person.totalsEls.keep, alloc.keep);

      person.totalsEls.balance.textContent = formatCurrency(alloc.balancingTransfer);
      updateValueState(person.totalsEls.balance, alloc.balancingTransfer);
    });

    renderAccounts();
    return allocation;
  }

  function updateDirectSelect() {
    directAccountSelect.innerHTML = '<option value="">Select account</option>';
    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = acc.name;
      directAccountSelect.appendChild(opt);
    });
  }

  function renderAccounts() {
    accountsGrid.innerHTML = '';
    accounts.forEach(account => renderAccount(account));
  }

  function renderAccount(account) {
    const card = document.createElement('article');
    card.className = 'account-card';
    card.dataset.account = account.id;

    const header = document.createElement('div');
    header.className = 'account-header';

    const nameInput = document.createElement('input');
    nameInput.className = 'account-name';
    nameInput.value = account.name;
    nameInput.addEventListener('input', () => {
      account.name = nameInput.value.trim();
      persistState();
    });

    const typeSelect = document.createElement('select');
    typeSelect.className = 'account-type';
    ['savings', 'investment', 'tax', 'other'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === account.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => {
      account.type = typeSelect.value;
      persistState();
    });

    const allocInput = document.createElement('input');
    allocInput.className = 'account-allocation';
    allocInput.type = 'number';
    allocInput.min = '0';
    allocInput.max = '100';
    allocInput.step = '0.01';
    allocInput.value = account.allocationPercentage;
    allocInput.addEventListener('input', () => {
      account.allocationPercentage = Number(allocInput.value);
      persistState();
    });

    const startingInput = document.createElement('input');
    startingInput.className = 'account-starting';
    startingInput.type = 'number';
    startingInput.step = '0.01';
    startingInput.value = account.startingBalance;
    startingInput.addEventListener('input', () => {
      account.startingBalance = Number(startingInput.value);
      persistState();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-account';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      const index = accounts.indexOf(account);
      if (index > -1) {
        accounts.splice(index, 1);
        renderAccounts();
        updateDirectSelect();
        persistState();
      }
    });

    header.append(nameInput, typeSelect, allocInput, startingInput, removeBtn);

    const breakdown = document.createElement('div');
    breakdown.className = 'account-breakdown';

    const startingCard = document.createElement('div');
    startingCard.className = 'breakdown-card';
    startingCard.innerHTML = '<strong>Starting Balance</strong><span class="pill" data-field="starting-display"></span>';

    const contribCard = document.createElement('div');
    contribCard.className = 'breakdown-card';
    contribCard.innerHTML = '<strong>Contributions</strong><span class="pill" data-field="contributions"></span>';

    const directCard = document.createElement('div');
    directCard.className = 'breakdown-card';
    directCard.innerHTML = '<strong>Direct Additions</strong><span class="pill" data-field="direct-total"></span>';

    breakdown.append(startingCard, contribCard, directCard);

    const totalDiv = document.createElement('div');
    totalDiv.className = 'account-total';
    totalDiv.innerHTML = '<span>Total in account</span><span data-field="account-total"></span>';

    const directList = document.createElement('div');
    directList.className = 'direct-list';
    directList.dataset.role = 'account-direct';
    directList.dataset.accountId = account.id;

    card.append(header, breakdown, totalDiv, directList);

    accountsGrid.appendChild(card);

    // update values
    const allocation = lastAllocation;
    const accountContrib = allocation?.accountContributions?.find(c => c.accountId === account.id)?.amount || 0;
    const directTotal = account.directEntries.reduce((sum, e) => sum + e.amount, 0);
    const total = account.startingBalance + accountContrib + directTotal;

    card.querySelector('[data-field="starting-display"]').textContent = formatCurrency(account.startingBalance);
    card.querySelector('[data-field="contributions"]').textContent = formatCurrency(accountContrib);
    card.querySelector('[data-field="direct-total"]').textContent = formatCurrency(directTotal);
    card.querySelector('[data-field="account-total"]').textContent = formatCurrency(total);

    // render direct list
    directList.innerHTML = '';
    if (account.directEntries.length === 0) {
      ensureEntriesPlaceholder(directList, 'No direct additions yet.');
    } else {
      account.directEntries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'direct-item';
        item.innerHTML = `<span>${entry.description}</span><span>${formatCurrency(entry.amount)}</span><button data-action="remove-direct" data-entry-id="${entry.id}">Remove</button>`;
        directList.appendChild(item);
      });
    }
  }

  function renderSnapshots() {
    snapshotList.innerHTML = '';
    if (monthlySnapshots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'snapshot-empty';
      empty.textContent = 'No snapshots captured yet. Log one above to begin your history.';
      snapshotList.appendChild(empty);
      drawSnapshotChart([]);
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
      remove.dataset.action = 'remove-snapshot';
      remove.dataset.snapshotId = snapshot.id;
      remove.textContent = 'Delete snapshot';

      item.append(header, metrics, remove);
      snapshotList.appendChild(item);
    });

    drawSnapshotChart(ordered);
  }

  function drawSnapshotChart(data) {
    lastSnapshotChartData = data;
    if (!snapshotChart) return;
    const ctx = snapshotChart.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = snapshotChart.clientWidth || 600;
    const height = snapshotChart.clientHeight || 220;

    snapshotChart.width = width * dpr;
    snapshotChart.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.fillRect(0, 0, width, height);

    if (!data.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px "Segoe UI", sans-serif';
      ctx.fillText('Snapshots will render here once captured.', 16, height / 2);
      return;
    }

    const padding = { top: 20, right: 24, bottom: 40, left: 48 };
    const months = data.map((snapshot) => snapshot.month);
    const values = data.map((snapshot) => snapshot.overall?.net ?? 0);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(...values);
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

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    const zeroY = yForValue(0);
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
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

    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, 'rgba(251, 191, 36, 0.35)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = gradient;
    ctx.lineTo(xForIndex(values.length - 1), height - padding.bottom);
    ctx.lineTo(xForIndex(0), height - padding.bottom);
    ctx.closePath();
    ctx.fill();

    values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = yForValue(value);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    });

    ctx.fillStyle = '#cbd5f5';
    ctx.font = '12px "Segoe UI", sans-serif';
    months.forEach((month, index) => {
      const x = xForIndex(index);
      ctx.textAlign = 'center';
      ctx.fillText(formatMonthLabel(month), x, height - 16);
    });

    ctx.textAlign = 'right';
    ctx.fillText(formatCurrency(maxValue), width - 12, padding.top + 12);
    ctx.fillText(formatCurrency(minValue), width - 12, height - padding.bottom);
  }

  window.addEventListener('resize', () => {
    if (lastSnapshotChartData.length) {
      drawSnapshotChart(lastSnapshotChartData);
    }
  });

  function formatMonthLabel(value) {
    if (!value) return 'Unknown';
    const [year, month] = value.split('-').map(Number);
    if (!year || !month) return value;
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  function formatTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function buildSnapshotPayload(monthKey, allocationOverride) {
    const timestamp = new Date();
    const allocation = allocationOverride || lastAllocation || calculateAllocations();
    const sharedTotals = computeSharedTotals(allocation);
    const overallIncome = people.reduce((sum, person) => sum + person.metrics.income, 0);
    const overallExpense = people.reduce((sum, person) => sum + person.metrics.expense, 0);

    return {
      id: createId(),
      month: monthKey,
      capturedAt: timestamp.toISOString(),
      currency: (currencyInput.value || '£').trim() || '£',
      allocation: {
        sharePercentage: allocation.sharePercentage,
        keepPerPerson: allocation.keepPerPerson,
      },
      people: people.map((person, index) => {
        const alloc = allocation.perPerson[index] || { keep: 0, shareContribution: 0, balancingTransfer: 0 };
        return {
          id: person.id,
          name: person.nameInput.value.trim() || `Person ${index + 1}`,
          metrics: { ...person.metrics },
          allocation: {
            keep: alloc.keep,
            shareContribution: alloc.shareContribution,
            balancingTransfer: alloc.balancingTransfer,
          },
        };
      }),
      shared: {
        startingBalance: sharedStartingBalance,
        contributionTotal: sharedTotals.contributionTotal,
        directTotal: sharedTotals.directTotal,
        total: sharedTotals.total,
      },
      overall: {
        income: overallIncome,
        expense: overallExpense,
        net: allocation.combinedNet,
      },
    };
  }

  function persistState() {
    if (isRestoring) return;
    try {
      const payload = {
        currencySymbol: (currencyInput.value || '£').trim() || '£',
        sharedPercentage: clampPercentage(Number(sharedPercentageInput.value)),
        people: people.map((person) => ({
          id: person.id,
          name: person.nameInput.value.trim(),
          entries: person.entries.map((entry) => ({
            id: entry.id,
            description: entry.description,
            amount: entry.amount,
            type: entry.type,
          })),
        })),
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          allocationPercentage: account.allocationPercentage,
          startingBalance: account.startingBalance,
          directEntries: account.directEntries.map((entry) => ({
            id: entry.id,
            description: entry.description,
            amount: entry.amount,
          })),
        })),
        snapshots: monthlySnapshots,
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist planner state', error);
    }
  }

  function applyPersistedState() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      if (!state || typeof state !== 'object') return;
      isRestoring = true;

      if (state.currencySymbol) {
        currencyInput.value = state.currencySymbol;
      }

      if (typeof state.sharedPercentage === 'number') {
        sharedPercentageInput.value = clampPercentage(state.sharedPercentage);
      }

      if (state.people) {
        state.people.forEach((savedPerson, index) => {
          const person = people.find((p) => p.id === savedPerson.id) || people[index];
          if (!person) return;
          if (typeof savedPerson.name === 'string') {
            person.nameInput.value = savedPerson.name;
          }
          if (Array.isArray(savedPerson.entries)) {
            person.entries = savedPerson.entries
              .map((entry) => ({
                id: entry.id || createId(),
                description: String(entry.description || '').trim(),
                amount: Math.abs(Number(entry.amount)) || 0,
                type: entry.type === 'expense' ? 'expense' : 'income',
              }))
              .filter((entry) => entry.description && entry.amount > 0);
          }
        });
      }

      }

      if (Array.isArray(state.accounts)) {
        accounts.splice(0, accounts.length, ...state.accounts.map((acc) => ({
          id: acc.id || createId(),
          name: String(acc.name || '').trim(),
          type: acc.type || 'savings',
          allocationPercentage: Number(acc.allocationPercentage) || 0,
          startingBalance: Number(acc.startingBalance) || 0,
          directEntries: Array.isArray(acc.directEntries) ? acc.directEntries
            .map((entry) => ({
              id: entry.id || createId(),
              description: String(entry.description || '').trim(),
              amount: Math.abs(Number(entry.amount)) || 0,
            }))
            .filter((entry) => entry.description && entry.amount > 0) : [],
        })));
        renderAccounts();
        updateDirectSelect();
      }

      if (Array.isArray(state.snapshots)) {
        monthlySnapshots.splice(0, monthlySnapshots.length, ...state.snapshots.map((snapshot) => ({
          ...snapshot,
          id: snapshot.id || createId(),
        })));
      }
    } catch (error) {
      console.error('Failed to restore planner state', error);
    } finally {
      isRestoring = false;
    }
  }

  function announceSnapshot(message) {
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

  people.forEach((person) => {
    const descriptionInput = person.form.querySelector('[name="description"]');
    const amountInput = person.form.querySelector('[name="amount"]');

    const ensureFocus = () => {
      descriptionInput?.focus();
    };

    const toggleDetail = (type) => {
      const hasItems = person.entries.some((entry) => entry.type === type);
      if (!hasItems) {
        person.detailState.open = null;
        renderPerson(person);
        return;
      }

      person.detailState.open = person.detailState.open === type ? null : type;
      renderPerson(person);
    };

    const handleAdd = (type) => {
      const description = (descriptionInput?.value || '').trim();
      const amountValue = parseFloat(amountInput?.value || '');

      if (!description) {
        ensureFocus();
        return;
      }

      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        amountInput?.focus();
        return;
      }

      person.entries.push({
        id: createId(),
        description,
        amount: Math.abs(amountValue),
        type,
      });

      person.detailState.open = type;
      person.form.reset();
      if (person.typeInput) {
        person.typeInput.value = type;
      }
      ensureFocus();
      renderPerson(person);
      renderSharedSummary();
      persistState();
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
        const entryEl = target.closest('.detail-item');
        if (!entryEl) return;
        const entryId = entryEl.dataset.entryId;

        if (target.dataset.action === 'remove-entry') {
          person.entries = person.entries.filter((entry) => entry.id !== entryId);
          if (!person.entries.some((entry) => entry.type === typeKey)) {
            person.detailState.open = null;
          }
          renderPerson(person);
          renderSharedSummary();
          persistState();
          return;
        }

        if (target.dataset.action === 'edit-entry') {
          enterDetailEditMode(entryEl, person, entryId);
          return;
        }

        if (target.dataset.action === 'save-entry') {
          saveDetailEntry(entryEl, person, entryId);
          return;
        }

        if (target.dataset.action === 'cancel-edit') {
          renderPerson(person);
          return;
        }
      });
    });

    person.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const type = person.typeInput?.value === 'expense' ? 'expense' : 'income';
      handleAdd(type);
    });

    person.nameInput.addEventListener('input', () => {
      renderSharedSummary();
      renderSnapshots();
      persistState();
    });

    renderPerson(person);
  });

  addAccountForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(addAccountForm);
    const name = formData.get('name').trim();
    const type = formData.get('type');
    const allocation = Number(formData.get('allocation'));
    const startingBalance = Number(formData.get('startingBalance'));
    if (!name || allocation < 0 || allocation > 100) return;
    const account = {
      id: createId(),
      name,
      type,
      allocationPercentage: allocation,
      startingBalance,
      directEntries: [],
    };
    accounts.push(account);
    renderAccounts();
    updateDirectSelect();
    persistState();
    addAccountForm.reset();
  });

  accountDirectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(accountDirectForm);
    const accountId = formData.get('account');
    const description = formData.get('description').trim();
    const amount = Number(formData.get('amount'));
    if (!accountId || !description || amount <= 0) return;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    const entry = {
      id: createId(),
      description,
      amount,
    };
    account.directEntries.push(entry);
    renderAccounts();
    persistState();
    accountDirectForm.reset();
  });

  accountsGrid.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'remove-direct') {
      const accountId = e.target.closest('.account-card').dataset.account;
      const entryId = e.target.dataset.entryId;
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        account.directEntries = account.directEntries.filter(e => e.id !== entryId);
        renderAccounts();
        persistState();
      }
    }
  });

  sharedPercentageInput.addEventListener('input', () => {
    renderSharedSummary();
    persistState();
  });

  currencyInput.addEventListener('input', () => {
    renderSharedSummary();
    renderSnapshots();
    persistState();
  });

  snapshotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    people.forEach(renderPerson);
    const currentAllocation = renderSharedSummary();

    const monthKey = snapshotMonthInput.value || (() => {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return `${now.getFullYear()}-${month}`;
    })();

    const payload = buildSnapshotPayload(monthKey, currentAllocation);
    const existingIndex = monthlySnapshots.findIndex((snapshot) => snapshot.month === monthKey);
    if (existingIndex >= 0) {
      payload.id = monthlySnapshots[existingIndex].id;
      monthlySnapshots[existingIndex] = payload;
      announceSnapshot(`Updated snapshot for ${formatMonthLabel(monthKey)}.`);
    } else {
      monthlySnapshots.push(payload);
      announceSnapshot(`Captured snapshot for ${formatMonthLabel(monthKey)}.`);
    }

    renderSnapshots();
    persistState();
  });

  snapshotList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === 'remove-snapshot') {
      const snapshotId = target.dataset.snapshotId;
      const index = monthlySnapshots.findIndex((snapshot) => snapshot.id === snapshotId);
      if (index >= 0) {
        const [removed] = monthlySnapshots.splice(index, 1);
        announceSnapshot(`Deleted snapshot for ${formatMonthLabel(removed.month)}.`);
        renderSnapshots();
        persistState();
      }
    }
  });

  applyPersistedState();
  people.forEach(renderPerson);
  renderSharedSummary();
  updateDirectSelect();
  renderSnapshots();
  initializeSnapshotMonth();
  persistState();
})();
