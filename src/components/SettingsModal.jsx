import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventToKeyString, formatKeyLabel } from '../lib/keybindings';
import { useWheelSlider } from '../lib/useWheelSlider';
import { checkForUpdate, withV } from '../lib/updateCheck';
import { formatListenTime, formatDay } from '../lib/listening';

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
  { id: 'listening', label: 'Listening' },
  { id: 'about', label: 'About' }
];

const MODIFIER_KEYS = new Set(['Shift', 'Meta', 'Control', 'Alt']);

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
  onResetLibrary,
  libraryRoot,
  onChooseLibraryRoot,
  lastSnapshotAt = null,
  lastSyncAt = null,
  trackCount = 0,
  // listening stats, computed in App (src/lib/listening.js): { empty,
  // totalSeconds, totalPlays, since, machines, topTracks, topArtists }
  listening = null,
  onClose
}) {
  const [activeSection, setActiveSection] = useState('appearance');
  const [query, setQuery] = useState('');
  const [capturedKey, setCapturedKey] = useState(null); // key-combo used as a filter
  const [captureMode, setCaptureMode] = useState(false); // waiting for a keypress
  const [listeningFor, setListeningFor] = useState(null); // action being rebound

  const [version, setVersion] = useState('');
  // Manual "Check for updates" — same checkForUpdate() the launch-time
  // banner uses, but always reports a result (up to date / available /
  // couldn't check), regardless of any dismissed-version stamp in
  // localStorage, so this button is the way to verify the check actually
  // works without waiting for a real newer release.
  const [updateCheckState, setUpdateCheckState] = useState('idle'); // 'idle' | 'checking' | 'done'
  const [updateCheckResult, setUpdateCheckResult] = useState(null); // result of checkForUpdate()
  // the per-machine library root — App owns it (it's also what the
  // first-launch gate reads); this pane just shows it and offers the picker
  const libDir = libraryRoot?.root || '';
  const libDirMissing = !!libraryRoot?.root && !libraryRoot?.exists;

  // 5 points/notch — a few points, not 1 (too fine to feel) and not 20 (too
  // coarse). See useWheelSlider above for why this can't just be onWheel.
  const bgMovementWheelRef = useWheelSlider(backgroundMovement, onSetBackgroundMovement, 5);

  // the number next to the slider is click-to-edit (2026-09-05) — same
  // commit/cancel shape as the playlist-title inline rename in
  // LibraryList.jsx: a single blur handler is the one place that decides
  // whether to save or revert, reached whether the blur was caused by
  // Enter, Escape, or genuinely clicking away, so there's exactly one commit
  // path rather than one per trigger.
  const [editingBgValue, setEditingBgValue] = useState(false);
  const [bgValueDraft, setBgValueDraft] = useState('');
  const bgValueCancelledRef = useRef(false);
  const bgValueInputRef = useRef(null);

  useEffect(() => {
    if (editingBgValue) {
      bgValueInputRef.current?.focus();
      bgValueInputRef.current?.select();
    }
  }, [editingBgValue]);

  function startEditingBgValue() {
    bgValueCancelledRef.current = false;
    setBgValueDraft(String(Math.round(backgroundMovement)));
    setEditingBgValue(true);
  }

  function commitOrCancelBgValue() {
    setEditingBgValue(false);
    if (bgValueCancelledRef.current) return;
    const n = Number(bgValueDraft.trim());
    // garbage input (empty, non-numeric, NaN) -> quietly revert rather than
    // clamping something meaningless to 0 or breaking
    if (!Number.isFinite(n)) return;
    onSetBackgroundMovement(Math.min(100, Math.max(0, Math.round(n))));
  }

  // Escape is handled up in the capture-phase handleKeyDown effect below,
  // not here — it has to run before this ever would (capture always
  // precedes an input's own bubble-phase onKeyDown), since without that,
  // Escape fell through to closing the whole Settings modal instead of just
  // this edit. Only Enter is this handler's to own.
  function handleBgValueKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur(); // -> commitOrCancelBgValue via onBlur
    }
  }

  useEffect(() => {
    window.electronAPI?.appVersion?.().then(setVersion).catch(() => {});
  }, []);

  async function handleCheckForUpdates() {
    setUpdateCheckState('checking');
    setUpdateCheckResult(null);
    const v = await window.electronAPI?.appVersion?.().catch(() => null);
    const result = v ? await checkForUpdate(v) : { error: true };
    setUpdateCheckResult(result);
    setUpdateCheckState('done');
  }

  // Changing the root with tracks already in the library only makes sense
  // if the folder itself was moved — every stored path is relative to it,
  // so pointing at some other folder makes every track "missing" at once.
  function changeLibraryRoot() {
    if (trackCount > 0 && !libDirMissing) {
      const ok = window.confirm(
        `Change the library folder?\n\nYour ${trackCount} tracks keep their paths relative to the folder, so only do this if you moved the folder itself. Pointing at a different folder will make every track show as missing.`
      );
      if (!ok) return;
    }
    onChooseLibraryRoot?.();
  }

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
        key: 'lib-sync',
        section: 'library',
        label: 'Sync snapshot',
        keywords: 'library sync snapshot dropbox machine written merged json'
      },
      {
        key: 'lib-reset',
        section: 'library',
        label: 'Reset library',
        keywords: 'library reset wipe clear erase delete database fresh start'
      },
      {
        key: 'listening-total',
        section: 'listening',
        label: 'Total time listened',
        keywords: 'listening stats statistics total time listened hours plays play count history'
      },
      {
        key: 'listening-tracks',
        section: 'listening',
        label: 'Top tracks',
        keywords: 'listening stats top tracks most played songs plays time'
      },
      {
        key: 'listening-artists',
        section: 'listening',
        label: 'Top artists',
        keywords: 'listening stats top artists most played plays time'
      },
      {
        key: 'version',
        section: 'about',
        label: 'Version',
        keywords: 'about version build release playdisc'
      },
      {
        key: 'check-updates',
        section: 'about',
        label: 'Check for updates',
        keywords: 'about update updates check version release github new latest'
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

      // 2026-09-05: the background-movement value's inline edit is a
      // sub-mode too, same shape as listeningFor/captureMode above — without
      // this, this handler's own capture-phase Escape (below) fired FIRST
      // (capture always precedes the input's own bubble-phase onKeyDown) and
      // closed the whole Settings modal out from under the edit instead of
      // just cancelling it. bgValueCancelledRef (read in
      // commitOrCancelBgValue) still needs to be set here: removing the
      // <input> by flipping editingBgValue false fires a native blur as it
      // unmounts, which would otherwise commit the (to-be-discarded) draft.
      if (editingBgValue) {
        if (isDismiss) {
          e.preventDefault();
          e.stopPropagation();
          bgValueCancelledRef.current = true;
          setEditingBgValue(false);
        }
        return;
      }

      if (isDismiss) {
        e.preventDefault();
        // Unlike the listeningFor/captureMode branches above, this one used
        // to skip stopPropagation() — so Cmd+W closed Settings here and then
        // kept bubbling to App.jsx's own document-level Cmd+W handler on the
        // very same keypress, which (with nothing else open) went on to
        // close the app window. Stop it here, same as the other branches.
        e.stopPropagation();
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
  }, [listeningFor, captureMode, editingBgValue, query, capturedKey, onClose, onSetKeybindings]);

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
              {editingBgValue ? (
                <input
                  ref={bgValueInputRef}
                  data-sync-passive=""
                  className="settings-slider-value settings-slider-value-input"
                  value={bgValueDraft}
                  onChange={(e) => setBgValueDraft(e.target.value)}
                  onKeyDown={handleBgValueKeyDown}
                  onBlur={commitOrCancelBgValue}
                  inputMode="numeric"
                  maxLength={4}
                />
              ) : (
                <span
                  className="settings-slider-value settings-slider-value-editable"
                  onClick={startEditingBgValue}
                  title="click to type an exact value"
                >
                  {Math.round(backgroundMovement)}
                </span>
              )}
            </div>
          </div>
        );
      case 'lib-location':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Music library folder</span>
              <span className="settings-field-desc">
                {libDir || 'Not set'}
                {libDirMissing ? ' · folder not found' : ''}
              </span>
            </div>
            <span className="settings-field-control settings-field-buttons">
              <button
                className="settings-linkish"
                onClick={changeLibraryRoot}
                disabled={!window.electronAPI?.chooseLibraryRoot}
              >
                {libDir ? 'Change…' : 'Choose…'}
              </button>
              <button
                className="settings-linkish"
                onClick={() => window.electronAPI?.revealLibraryDir?.()}
                disabled={!libDir || libDirMissing || !window.electronAPI?.revealLibraryDir}
              >
                Reveal in Finder
              </button>
            </span>
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
      case 'lib-sync':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Sync snapshot</span>
              <span className="settings-field-desc">
                {libraryRoot?.machineId
                  ? `.playdisc/sync/${libraryRoot.machineId}.json in the library folder`
                  : 'Available once a library folder is set'}
              </span>
            </div>
            <span className="settings-field-control settings-field-value">
              {[
                lastSnapshotAt ? `written ${new Date(lastSnapshotAt).toLocaleTimeString()}` : 'not written yet',
                lastSyncAt ? `merged ${new Date(lastSyncAt).toLocaleTimeString()}` : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        );
      case 'lib-reset':
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Reset library</span>
              <span className="settings-field-desc">
                Forgets every track, playlist, version, note and tag. Audio files on disk are left in
                place. Keybindings and appearance settings are kept.
              </span>
            </div>
            <button className="settings-reset-btn settings-field-control" onClick={onResetLibrary}>
              Reset library…
            </button>
          </div>
        );
      case 'listening-total': {
        const l = listening;
        const scope =
          !l || l.machines <= 1
            ? 'this Mac only'
            : `this Mac and ${l.machines - 1} other${l.machines - 1 === 1 ? '' : 's'}`;
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Total time listened</span>
              <span className="settings-field-desc">
                {l?.since ? `since ${formatDay(l.since)} · ${scope}` : 'nothing recorded yet'}
              </span>
            </div>
            <span className="settings-field-control settings-field-value">
              {formatListenTime(l?.totalSeconds || 0)} · {l?.totalPlays || 0} {l?.totalPlays === 1 ? 'play' : 'plays'}
            </span>
          </div>
        );
      }
      case 'listening-tracks': {
        const rows = listening?.topTracks || [];
        if (!rows.length) return null;
        return (
          <div className="settings-field settings-field-stack" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Top tracks</span>
              <span className="settings-field-desc">by time listened · plays</span>
              <ol className="settings-rank-list">
                {rows.map((r, i) => (
                  <li key={r.track.id}>
                    <span className="settings-rank-n">{i + 1}</span>
                    <span className="settings-rank-title" title={r.track.title}>{r.track.title}</span>
                    <span className="settings-rank-sub" title={r.track.artist}>{r.track.artist}</span>
                    <span className="settings-rank-nums">
                      {formatListenTime(r.seconds)} · {r.plays}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        );
      }
      case 'listening-artists': {
        const rows = listening?.topArtists || [];
        if (!rows.length) return null;
        return (
          <div className="settings-field settings-field-stack" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Top artists</span>
              <span className="settings-field-desc">by time listened · plays</span>
              <ol className="settings-rank-list artists">
                {rows.map((r, i) => (
                  <li key={r.name}>
                    <span className="settings-rank-n">{i + 1}</span>
                    <span className="settings-rank-title" title={r.name}>{r.name}</span>
                    <span className="settings-rank-nums">
                      {formatListenTime(r.seconds)} · {r.plays}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        );
      }
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
      case 'check-updates': {
        let statusText = null;
        if (updateCheckState === 'checking') {
          statusText = 'Checking…';
        } else if (updateCheckState === 'done' && updateCheckResult) {
          if (updateCheckResult.error) {
            statusText = "Couldn't check for updates — you may be offline.";
          } else if (updateCheckResult.updateAvailable) {
            statusText = `${withV(updateCheckResult.latest)} is available (you're on ${withV(updateCheckResult.current)}).`;
          } else {
            statusText = `You're up to date (${withV(updateCheckResult.current)}).`;
          }
        }
        return (
          <div className="settings-field" key={key}>
            <div className="settings-field-main">
              <span className="settings-field-label">Check for updates</span>
              {statusText && (
                <span
                  className="settings-field-desc"
                  onClick={
                    updateCheckResult?.updateAvailable
                      ? () => window.electronAPI?.openExternal?.(updateCheckResult.htmlUrl)
                      : undefined
                  }
                  style={updateCheckResult?.updateAvailable ? { cursor: 'pointer', textDecoration: 'underline' } : undefined}
                >
                  {statusText}
                </span>
              )}
            </div>
            <button
              className="settings-reset-btn settings-field-control"
              onClick={handleCheckForUpdates}
              disabled={updateCheckState === 'checking'}
            >
              {updateCheckState === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          </div>
        );
      }
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
            {renderField('lib-sync')}
            {renderField('lib-reset')}
          </>
        );
      case 'listening':
        return (
          <>
            <h3 className="settings-section-title">Listening</h3>
            {!listening || listening.empty ? (
              <p className="settings-placeholder">Nothing yet. Listening stats start from today.</p>
            ) : (
              <>
                {renderField('listening-total')}
                {renderField('listening-tracks')}
                {renderField('listening-artists')}
              </>
            )}
          </>
        );
      case 'about':
        return (
          <>
            <h3 className="settings-section-title">About</h3>
            {renderField('version')}
            {renderField('check-updates')}
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
            data-sync-passive=""
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
