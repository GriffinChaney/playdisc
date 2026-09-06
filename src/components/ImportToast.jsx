import { useEffect, useState } from 'react';

// Top-right confirmation toast shown after an import finishes. Slides in from
// the right, holds briefly, then slides back out off-screen and asks the
// parent to unmount it. Keyed by `toast.id` so a fresh import restarts the
// timers even if one is still on screen.
const HOLD_MS = 2500;
const SLIDE_MS = 380;

export default function ImportToast({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setExiting(false);
    const outTimer = setTimeout(() => setExiting(true), HOLD_MS);
    const doneTimer = setTimeout(() => onDismiss(), HOLD_MS + SLIDE_MS);
    return () => {
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, [toast.id, onDismiss]);

  const { count, error, failed, skipped, loaded, loadedFrom, synced } = toast;
  const isError = !!error;
  let text;
  if (error) text = 'Import failed';
  else if (loaded != null) {
    // first sync on an empty library: filled from the other machine's snapshot
    text = `Loaded ${loaded} ${loaded === 1 ? 'track' : 'tracks'} from ${loadedFrom || 'a library snapshot'}`;
  } else if (synced != null) {
    // a later merge brought changes in from another machine
    text = `Synced ${synced} ${synced === 1 ? 'change' : 'changes'} from Dropbox`;
  } else {
    const extras = [failed && `${failed} failed`, skipped && `${skipped} already in library`]
      .filter(Boolean)
      .join(', ');
    text = `${count} ${count === 1 ? 'sample' : 'samples'} imported${extras ? ` · ${extras}` : ''}`;
  }

  return (
    <div className={`import-toast${exiting ? ' exiting' : ''}${isError ? ' error' : ''}`}>
      <span className="import-toast-icon" aria-hidden="true">
        {isError ? (
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M8 1.5v9M8 13.5v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        )}
      </span>
      <span className="import-toast-text">{text}</span>
    </div>
  );
}
