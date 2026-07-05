export const PRESET_CATEGORIES = {
  income: ['Salary', 'Freelance', 'Business', 'Benefits', 'Investments', 'Pension', 'Other'],
  expense: ['Housing', 'Food', 'Transport', 'Bills', 'Health', 'Leisure', 'Debt', 'Childcare', 'Other'],
};

/**
 * Keeps the shared <datalist> elements topped up with preset categories plus
 * every custom category the user has typed, so the free-text category inputs
 * offer suggestions without limiting what can be entered.
 */
export function refreshCategoryDatalists(people) {
  const used = { income: new Set(PRESET_CATEGORIES.income), expense: new Set(PRESET_CATEGORIES.expense) };
  people.forEach((person) => {
    person.entries.forEach((entry) => {
      const type = entry.type === 'expense' ? 'expense' : 'income';
      const category = (entry.category || '').trim();
      if (category) used[type].add(category);
    });
  });

  ['income', 'expense'].forEach((type) => {
    const datalist = document.getElementById(`categories-${type}`);
    if (!datalist) return;
    datalist.innerHTML = '';
    [...used[type]].sort((a, b) => a.localeCompare(b)).forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      datalist.appendChild(option);
    });
  });
}
