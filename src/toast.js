let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container no-print';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Shows a transient toast. Pass `onUndo` to render an Undo button; the toast
 * dismisses itself after `duration` ms or as soon as Undo is clicked.
 */
export function showToast(message, { onUndo = null, duration = 6000 } = {}) {
  const host = ensureContainer();
  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  const dismiss = () => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  };

  if (onUndo) {
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.textContent = 'Undo';
    undoButton.addEventListener('click', () => {
      dismiss();
      onUndo();
    });
    toast.appendChild(undoButton);
  }

  host.appendChild(toast);
  // Keep at most 3 toasts on screen.
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(dismiss, duration);
}
