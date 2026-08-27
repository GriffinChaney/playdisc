import { useState } from 'react';

// "recently played" panel — collapsible, newest first, click a row to jump
// back to that point in the play history. Extracted from the old Sidebar.
export default function HistoryPanel({ history, historyIndex, tracks, onJumpToHistory, onClearHistory }) {
  const [open, setOpen] = useState(() => localStorage.getItem('historyPanelOpen') === '1');

  if (history.length === 0) return null;

  return (
    <div className="history-panel">
      <div className="queue-panel-header">
        <button
          className="history-toggle"
          onClick={() => {
            const next = !open;
            setOpen(next);
            localStorage.setItem('historyPanelOpen', next ? '1' : '0');
          }}
        >
          <span className={`history-chevron${open ? ' open' : ''}`} aria-hidden="true">
            ›
          </span>
          recently played — {history.length}
        </button>
        {open && (
          <button className="queue-clear-btn" onClick={onClearHistory}>
            clear
          </button>
        )}
      </div>
      {open && (
        <div className="history-list">
          {history
            .map((entry, i) => ({ entry, i }))
            .reverse()
            .map(({ entry, i }) => {
              const t = tracks.find((tr) => tr.id === entry.trackId);
              if (!t) return null;
              return (
                <button
                  key={entry.hid}
                  className={`history-item${i === historyIndex ? ' current' : ''}`}
                  onClick={() => onJumpToHistory(i)}
                  title={`${t.title} — ${t.artist}`}
                >
                  <span className="history-item-title">{t.title}</span>
                  <span className="history-item-artist">{t.artist}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
