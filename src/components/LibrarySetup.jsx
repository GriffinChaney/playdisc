import { createPortal } from 'react-dom';

// Blocking first-launch / recovery gate — the one modal in the app that
// can't be dismissed (no Escape, no backdrop click), because there is
// nothing usable behind it until one of its two actions runs:
//
// - `legacy`: IndexedDB holds records from before the relative-path rework.
//   App.jsx refused to load them (see legacyLibrary there); the only way
//   forward is Reset library. Shown first, even if a root is also missing.
// - no usable root: nothing configured yet (first launch on this machine),
//   or a configured folder that isn't there right now. Choose folder…
//   opens the native picker in main.
//
// Renders above everything, including Settings, so Cmd+, still works but
// can't be used to get around it.
export default function LibrarySetup({ legacy, libraryRoot, onChooseRoot, onResetLibrary }) {
  const configured = libraryRoot?.root || null;
  const missingFolder = !!configured && !libraryRoot?.exists;

  let title;
  let body;
  let action;
  if (legacy) {
    title = 'This library needs a reset';
    body =
      'The tracks stored on this Mac predate library sync (they still use absolute file paths), so they can’t be loaded. Reset the library to start fresh, then re-import your music into the library folder. Audio files on disk are not deleted.';
    action = (
      <button type="button" className="prompt-modal-btn danger" onClick={onResetLibrary}>
        Reset library…
      </button>
    );
  } else if (missingFolder) {
    title = 'Library folder not found';
    body = (
      <>
        Playdisc can’t find <code className="library-setup-path">{configured}</code>. If you moved it, choose
        its new location. Tracks keep their paths relative to the folder, so nothing needs re-importing.
      </>
    );
    action = (
      <button type="button" className="prompt-modal-btn primary" onClick={onChooseRoot}>
        Choose folder…
      </button>
    );
  } else {
    title = 'Choose your library folder';
    body =
      'Playdisc copies imported music into one folder. Pick a folder inside Dropbox to share the same library between your Macs — each Mac chooses its own location for that folder.';
    action = (
      <button type="button" className="prompt-modal-btn primary" onClick={onChooseRoot}>
        Choose folder…
      </button>
    );
  }

  return createPortal(
    <div className="modal-overlay modal-overlay-blur library-setup-overlay" role="dialog" aria-modal="true">
      <div className="prompt-modal library-setup" onMouseDown={(e) => e.stopPropagation()}>
        <p className="library-setup-title">{title}</p>
        <p className="library-setup-body">{body}</p>
        <div className="prompt-modal-actions">{action}</div>
      </div>
    </div>,
    document.body
  );
}
