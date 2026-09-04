import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventToKeyString, formatKeyLabel } from '../lib/keybindings';

// Settings surface: a sidebar of sections + a content pane, with a search
// bar across the top that filters settings from every section into a flat
// result list. The search bar also has a "capture" mode (the keyboard
// glyph) — press an actual key combo and it filters to whatever shortcut is
// bound to it, Cubase-style.
//
// Adding a setting later = add a row to INDEX (below) + a case to
// renderField + list its key in the relevant section pane. No layout work.

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'playback', label: 'Playback' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'library', label: 'Library' },
  { id: 'about', label: 'About' }
];

const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt']);

// Scroll-wheel support for a range slider — 2026-09-05. React's own onWheel
// prop is silently useless for this: React registers its delegated wheel
// listener as passive, so e.preventDefault() inside a JSX onWheel handler
// throws "Unable to preventDefault inside passive event listener
// invocation." and does nothing, letting the scroll fall through to
// whatever's behind the slider. A real, non-delegated addEventListener with
// {passive:false} is the only way to actually claim the wheel event. Value/
// onChange are read through refs (updated every render) so the listener
// itself only needs to be (re)attached when the DOM node changes identity
// (mount/unmount — e.g. switching Settings sections), not every render.
// Reusable for any other slider that wants the same behavior.
function useWheelSlider(value, onChange, step) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cleanupRef = useRef(null);

  return (el) => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? step : -step;
      onChangeRef.current(Math.min(100, Math.max(0, valueRef.current + delta)));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    cleanupRef.current = () => el.removeEventListener('wheel', onWheel);
  };
}

function KeyboardGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

export default function SettingsModal({
  theme,
  onSetTheme,
  backgroundMovement,
  onSetBackgroundMovement,
  keybindings,
  onSetKeybindings,
  onResetKeybindings,
  trackCount = 0,
  onClose
}) {
  const [activeSection, setActiveSection] = useState('appearance');
  const [query, setQuery] = useState('');
  const [capturedKey, setCapturedKey] = useState(null); // key-combo used as a filter
  const [captureMode, setCaptureMode] = useState(false); // waiting for a keypress
  const [listeningFor, setListeningFor] = useState(null); // action being rebound

  const [libDir, setLibDir] = useState('');
  const [version, setVersion] = useState('');

  // 5 points/notch — a few points, not 1 (too fine to feel) and not 20 (too
  // coarse). See useWheelSlider above for why this can't just be onWheel.
  const bgMovementWheelRef = useWheelSlider(backgroundMovement, onSetBackgroundMovement, 5);

  useEffect(() => {
    window.electronAPI?.mediaLibraryDir?.().then(setLibDir).catch(() => {});
    window.electronAPI?.appVersion?.().then(setVersion).catch(() => {});
  }, []);

  const searching = query.trim().length > 0 || capturedKey != null;

  // one flat, searchable index of every setting; section panes and the
  // search results both render from renderField() keyed off `key`
  const index = useMemo(() => {
    const rows = [
      {
        key: 'theme',
        section: 'appearance',
        label: 'Theme',
        keywords: 'appearance theme dark light mode color colour interface'
      },
      {
        key: 'background-movement',
        section: 'appearance',
        label: 'Background movement',
        keywords:
          'appearance background movement motion animation gradient drift fullscreen ambient reactive'
      },
      {
        key: 'lib-location',
        section: 'library',
        label: 'Music library folder',
        keywords: 'library folder location path directory reveal finder music files'
      },
      {
        key: 'lib-count',
        section: 'library',
        label: 'Tracks in library',
        keywords: 'library tracks count songs number total'
      },
      {
        key: 'version',
        section: 'about',
        label: 'Version',
        keywords: 'about version build release playdisc'
      }
    ];
    for (const [action, b] of Object.entries(keybindings)) {
      rows.push({
        key: `kb:${action}`,
        section: 'shortcuts',
        label: b.label,
        keywords: `${action} ${b.label} shortcut hotkey keybinding key ${formatKeyLabel(b.key)}`,
        boundKey: b.key
      });
    }
    return rows;
  }, [keybindings]);

  // always an array while `searching` is true (keep this consistent with the
  // `searching` predicate above, or renderResults reads .length off null)
  const results = useMemo(() => {
    if (capturedKey != null) return index.filter((r) => r.boundKey === capturedKey);
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return index.filter(
      (r) => r.label.toLowerCase().includes(q) || r.keywords.toLowerCase().includes(q)
    );
  }, [index, query, capturedKey]);

  // one capture-phase key handler for: rebinding a shortcut, the live
  // "press a shortcut" search capture, and dismiss (Escape — and Cmd/Ctrl+W,
  // which mirrors Escape exactly while Settings is open: exit a sub-mode
  // first, then clear an active search, then close the modal; the main
  // window has no Cmd+W of its own so nothing leaks to it)
  useEffect(() => {
    function handleKeyDown(e) {
      const isDismiss =
        e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w');

      if (listeningFor) {
        e.preventDefault();
        e.stopPropagation();
        if (isDismiss) {
          setListeningFor(null); // cancel the rebind, same as Escape always did
          return;
        }
        if (!MODIFIER_KEYS.has(e.key)) {
          onSetKeybindings(listeningFor, eventToKeyString(e));
          setListeningFor(null);
        }
        return;
      }

      if (captureMode) {
        e.preventDefault();
        e.stopPropagation();
        if (isDismiss) {
          setCaptureMode(false); // stop listening; keep the last key as a frozen filter
          return;
        }
        if (MODIFIER_KEYS.has(e.key)) return; // wait for a real key
        const combo = eventToKeyString(e); // each press replaces the last and re-filters
        if (combo && combo !== 'unidentified') setCapturedKey(combo);
        return; // stay in capture mode
      }

      if (isDismiss) {
        e.preventDefault();
        if (query || capturedKey) {
          setQuery('');
          setCapturedKey(null);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningFor, captureMode, query, capturedKey, onClose, onSetKeybindings]);

  function goToSection(id) {
    setQuery('');
    setCapturedKey(null);
    setCaptureMode(false);
    setActiveSection(id);
  }

  function clearSearch() {
    setQuery('');
    setCapturedKey(null);
    setCaptureMode(false);
  }

  function renderField(key) {
    if (key.startsWith('kb:')) {
      const action = key.slice(3);
      const b = keybindings[action];
      if (!b) return null;
      return (
        <div className="keybind-row" key={key}>
          <span>{b.label}</span>
          <button
            className={`keybind-btn${listeningFor === action ? ' listening' : ''}`}
            onClick={() => setListeningFor(action)}
          >
            {listeningFor === action ? 'press a key…' : formatKeyLabel(b.key)}
          </button>
        </div>
      );
    }

    switch (key) {
      case 'theme':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Theme</span>
              <span className="settings-field-desc">Light or dark interface</span>
            </div>
            <div className="theme-toggle settings-field-control">
              <button
                className={theme === 'dark' ? 'active' : ''}
                onClick={() => onSetTheme('dark')}
              >
                dark
              </button>
              <button
                className={theme === 'light' ? 'active' : ''}
                onClick={() => onSetTheme('light')}
              >
                light
              </button>
            </div>
          </div>
        );
      case 'background-movement':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Background movement</span>
              <span className="settings-field-desc">
                Ambient drift on the fullscreen background — 0 turns it off entirely
              </span>
            </div>
            <div className="settings-field-control settings-slider-control">
              <input
                type="range"
                className="volume-slider settings-slider"
                min="0"
                max="100"
                step="1"
                value={backgroundMovement}
                onChange={(e) => onSetBackgroundMovement(parseFloat(e.target.value))}
                ref={bgMovementWheelRef}
                style={{ '--vol-pct': `${backgroundMovement}%` }}
                aria-label="background movement"
              />
              <span className="settings-slider-value">{Math.round(backgroundMovement)}</span>
            </div>
          </div>
        );
      case 'lib-location':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Music library folder</span>
              <span className="settings-field-desc">{libDir || '—'}</span>
            </div>
            <button
              className="settings-linkish settings-field-control"
              onClick={() => window.electronAPI?.revealLibraryDir?.()}
              disabled={!window.electronAPI?.revealLibraryDir}
            >
              Reveal in Finder
            </button>
          </div>
        );
      case 'lib-count':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Tracks in library</span>
            </div>
            <span className="settings-field-control settings-field-value">
              {trackCount.toLocaleString()}
            </span>
          </div>
        );
      case 'version':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Version</span>
            </div>
            <span className="settings-field-control settings-field-value">
              Playdisc {version || '—'}
            </span>
          </div>
        );
      default:
        return null;
    }
  }

  function renderSection(id) {
    switch (id) {
      case 'appearance':
        return (
          <>
            <h3 className="settings-section-title">Appearance</h3>
            {renderField('theme')}
            {renderField('background-movement')}
          </>
        );
      case 'playback':
        return (
          <>
            <h3 className="settings-section-title">Playback</h3>
            <p className="settings-placeholder">
              Crossfade and fade-out options are coming here soon.
            </p>
          </>
        );
      case 'shortcuts':
        return (
          <>
            <h3 className="settings-section-title">Keyboard Shortcuts</h3>
            {Object.keys(keybindings).map((action) => renderField(`kb:${action}`))}
            <button className="settings-reset-btn" onClick={onResetKeybindings}>
              reset to defaults
            </button>
          </>
        );
      case 'library':
        return (
          <>
            <h3 className="settings-section-title">Library</h3>
            {renderField('lib-location')}
            {renderField('lib-count')}
          </>
        );
      case 'about':
        return (
          <>
            <h3 className="settings-section-title">About</h3>
            {renderField('version')}
          </>
        );
      default:
        return null;
    }
  }

  function renderResults() {
    if (!results || !results.length) {
      return (
        <p className="settings-empty">
          {capturedKey
            ? `No shortcut bound to ${formatKeyLabel(capturedKey)}`
            : `No settings match “${query.trim()}”`}
        </p>
      );
    }
    return SECTIONS.filter((s) => results.some((r) => r.section === s.id)).map((s) => (
      <div className="settings-result-group" key={s.id}>
        <p className="settings-result-tag">{s.label}</p>
        {results.filter((r) => r.section === s.id).map((r) => renderField(r.key))}
      </div>
    ));
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header settings-header">
          <h2>settings</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="close settings">
            ✕
          </button>
        </div>

        <div className="settings-search">
          <input
            className={`settings-search-input${captureMode ? ' capturing' : ''}`}
            placeholder={
              captureMode
                ? capturedKey
                  ? 'Press another shortcut…'
                  : 'Press a shortcut…'
                : 'Search settings'
            }
            value={capturedKey ? formatKeyLabel(capturedKey) : query}
            readOnly={captureMode || capturedKey != null}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              // clicking into the field to type text search drops a frozen
              // key filter — but not while capture is still live
              if (capturedKey && !captureMode) setCapturedKey(null);
            }}
          />
          {(query || capturedKey) && (
            <button
              className="settings-search-clear"
              onClick={clearSearch}
              aria-label="clear search"
            >
              ✕
            </button>
          )}
          <button
            className={`settings-capture-btn${captureMode || capturedKey ? ' active' : ''}`}
            onClick={() => {
              setQuery('');
              setCapturedKey(null);
              setCaptureMode((m) => !m);
            }}
            aria-label="search by pressing a shortcut"
            title="search by pressing a shortcut"
          >
            <KeyboardGlyph />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-sidebar">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`settings-sidebar-item${
                  !searching && activeSection === s.id ? ' active' : ''
                }`}
                onClick={() => goToSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {searching ? renderResults() : renderSection(activeSection)}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
