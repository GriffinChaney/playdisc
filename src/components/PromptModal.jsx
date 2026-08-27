import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Small single-field prompt. Electron doesn't implement window.prompt(), so
// anything that needs a typed string (e.g. naming a new playlist) uses this.
// Controlled from App: pass `config = { title, placeholder, defaultValue,
// confirmLabel, onSubmit }` or null.
export default function PromptModal({ config, onClose }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(config?.defaultValue ?? '');
  }, [config]);

  if (!config) return null;

  function submit(e) {
    e.preventDefault();
    const v = value.trim();
    if (v) config.onSubmit(v);
    onClose();
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <form className="prompt-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <p className="prompt-modal-title">{config.title}</p>
        <input
          autoFocus
          className="prompt-modal-input"
          placeholder={config.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="prompt-modal-actions">
          <button type="button" className="prompt-modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="prompt-modal-btn primary" disabled={!value.trim()}>
            {config.confirmLabel || 'Create'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
