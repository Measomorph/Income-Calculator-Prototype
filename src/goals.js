import { createId } from './format.js';

/**
 * Renders a list of savings goals with progress bars into `container` and
 * wires an add-goal form. `getProgress(goal)` supplies the current saved
 * amount (an account's projected balance, or a person's manually tracked
 * figure); `onSavedEdit` being set makes the saved amount user-editable.
 * `getEta(goal, saved)` may return a human ETA string ("≈ Mar 2027").
 * `undoable(label, mutate)` performs a deletion that can be undone.
 */
export function createGoalsView({ container, form, formatCurrency, getGoals, getProgress, getEta, onChange, onSavedEdit, undoable }) {
  function render() {
    const goals = getGoals();
    container.innerHTML = '';

    if (!goals.length) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'No goals yet.';
      container.appendChild(empty);
      return;
    }

    goals.forEach((goal) => {
      const item = document.createElement('div');
      item.className = 'goal-item';
      item.dataset.goalId = goal.id;

      const saved = getProgress(goal);
      const target = Number(goal.target) || 0;
      const pct = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : 0;

      const heading = document.createElement('div');
      heading.className = 'goal-heading';

      const name = document.createElement('strong');
      name.textContent = goal.name;

      const amounts = document.createElement('span');
      amounts.className = 'goal-amounts';
      amounts.textContent = `${formatCurrency(saved)} / ${formatCurrency(target)}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'goal-remove no-print';
      remove.dataset.action = 'remove-goal';
      remove.textContent = 'Remove';

      heading.append(name, amounts, remove);

      const bar = document.createElement('div');
      bar.className = 'goal-bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      bar.setAttribute('aria-label', `${goal.name}: ${Math.round(pct)}% of target`);

      const fill = document.createElement('div');
      fill.className = 'goal-fill';
      fill.style.width = `${pct}%`;
      if (pct >= 100) fill.classList.add('is-complete');
      bar.appendChild(fill);

      item.append(heading, bar);

      const eta = getEta ? getEta(goal, saved) : null;
      if (eta) {
        const etaLine = document.createElement('span');
        etaLine.className = 'goal-eta';
        etaLine.textContent = eta;
        item.appendChild(etaLine);
      }

      if (onSavedEdit) {
        const savedRow = document.createElement('label');
        savedRow.className = 'goal-saved no-print';
        savedRow.textContent = 'Saved so far ';
        const savedInput = document.createElement('input');
        savedInput.type = 'number';
        savedInput.step = '0.01';
        savedInput.min = '0';
        savedInput.value = (Number(goal.saved) || 0).toFixed(2);
        savedInput.addEventListener('change', () => {
          onSavedEdit(goal, Math.max(0, parseFloat(savedInput.value) || 0));
        });
        savedRow.appendChild(savedInput);
        item.appendChild(savedRow);
      }

      container.appendChild(item);
    });
  }

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.action !== 'remove-goal') return;
    const goalId = target.closest('.goal-item')?.dataset.goalId;
    const goals = getGoals();
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    undoable(`Removed goal “${goal.name}”`, () => {
      const index = goals.indexOf(goal);
      if (index >= 0) goals.splice(index, 1);
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = (data.get('goal-name') || '').toString().trim();
    const target = parseFloat(data.get('goal-target'));
    if (!name || !Number.isFinite(target) || target <= 0) return;
    getGoals().push({ id: createId(), name, target, saved: 0 });
    form.reset();
    onChange();
  });

  return { render };
}
