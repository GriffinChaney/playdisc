import { useEffect, useState } from 'react';
import { eventToKeyString, formatKeyLabel } from '../lib/keybindings';

export default function SettingsModal({ theme, onSetTheme, keybindings, onSetKeybindings, onResetKeybindings, onClose }) {
  const [subview, setSubview] = useState('main'); // 'main' | 'keybindings'
  const [listeningFor, setListeningFor] = useState(null);

  // Captures the next keydown to rebind an action, or closes on Escape.
  // Runs in the capture phase so it intercepts before App's own global
  // shortcut handler (which bails out entirely while settings are open).
  useEffect(() => {
    function handleKeyDown(e) {
      if (listeningFor) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key !== 'Escape') {
          onSetKeybindings(listeningFor, eventToKeyString(e));
        }
        setListeningFor(null);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningFor, onClose, onSetKeybindings]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {subview === 'main' ? (
          <>
            <div className="modal-header">
              <h2>settings</h2>
              <button className="modal-close-btn" onClick={onClose} aria-label="close settings">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-row">
                <span>appearance</span>
                <div className="theme-toggle">
                  <button className={theme === 'dark' ? 'active' : ''} onClick={() => onSetTheme('dark')}>
                    dark
                  </button>
                  <button className={theme === 'light' ? 'active' : ''} onClick={() => onSetTheme('light')}>
                    light
                  </button>
                </div>
              </div>
              <button className="settings-nav-btn" onClick={() => setSubview('keybindings')}>
                keyboard shortcuts →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-header">
              <button className="modal-back-btn" onClick={() => setSubview('main')}>
                ← back
              </button>
              <h2>keyboard shortcuts</h2>
              <button className="modal-close-btn" onClick={onClose} aria-label="close settings">
                ✕
              </button>
            </div>
            <div className="modal-body">
              {Object.entries(keybindings).map(([action, { label, key }]) => (
                <div className="keybind-row" key={action}>
                  <span>{label}</span>
                  <button
                    className={`keybind-btn${listeningFor === action ? ' listening' : ''}`}
                    onClick={() => setListeningFor(action)}
                  >
                    {listeningFor === action ? 'press a key…' : formatKeyLabel(key)}
                  </button>
                </div>
              ))}
              <button className="settings-reset-btn" onClick={onResetKeybindings}>
                reset to defaults
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
