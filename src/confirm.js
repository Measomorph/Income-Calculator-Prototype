const ARM_TIMEOUT_MS = 3000;

/**
 * Turns a button into a two-click "arm, then confirm" control so destructive
 * actions (removing an entry/snapshot) can't happen from a single accidental click.
 */
export function armForConfirm(button, { armedLabel = 'Confirm?', onConfirm }) {
  if (button.dataset.armed === 'true') {
    delete button.dataset.armed;
    clearTimeout(Number(button.dataset.armTimer));
    onConfirm();
    return;
  }

  const originalLabel = button.textContent;
  button.dataset.armed = 'true';
  button.textContent = armedLabel;
  button.classList.add('is-armed');

  const timer = setTimeout(() => {
    delete button.dataset.armed;
    button.textContent = originalLabel;
    button.classList.remove('is-armed');
  }, ARM_TIMEOUT_MS);

  button.dataset.armTimer = String(timer);
}
