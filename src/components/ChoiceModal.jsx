import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// A small modal that asks one question with 2+ buttons — window.confirm only
// offers OK/Cancel, and some choices (merge / add copy / cancel) need three.
// Controlled from App: pass `config = { title, message, choices: [{ value,
// label, primary, danger }], onChoose }` or null. `onChoose` gets the picked
// value; closing via Esc / backdrop counts as no choice. Enter picks the
// `primary` choice (the default) — so a dialog whose safe answer is the
// default can be dismissed from the keyboard without ever landing on the
// destructive one; a config with no primary choice ignores Enter.
export default function ChoiceModal({ config, onClose }) {
  useEffect(() => {
    if (!config) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter') {
        const def = config.choices.find((c) => c.primary);
        if (!def) return;
        e.stopPropagation();
        e.preventDefault();
        config.onChoose?.(def.value);
        onClose();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [config, onClose]);

  if (!config) return null;

  function pick(value) {
    config.onChoose?.(value);
    onClose();
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="prompt-modal" onMouseDown={(e) => e.stopPropagation()}>
        <p className="prompt-modal-title">{config.title}</p>
        {config.message && <p className="choice-modal-message">{config.message}</p>}
        <div className="prompt-modal-actions">
          {config.choices.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`prompt-modal-btn${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}`}
              onClick={() => pick(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
