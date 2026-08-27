import { memo, useRef, useState } from 'react';
import UploadButton from './UploadButton';
import QueuePanel from './QueuePanel';
import HistoryPanel from './HistoryPanel';

// Left column of the library view: upload, the "Imported" (whole-library)
// view, the playlist list (pinned first), a new-playlist affordance, then
// the queue and recently-played panels.
function PlaylistNav({
  playlists,
  activeView,
  onSelectView,
  onFilesSelected,
  onCreatePlaylist,
  onOpenMenu,
  onTogglePin,
  onReorderPlaylists,
  onRenamePlaylist,
  onDeletePlaylist,
  onPlayPlaylist,
  // queue + history
  queue,
  tracks,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
  history,
  historyIndex,
  onJumpToHistory,
  onClearHistory,
  onResizeStart
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTarget, setDropTarget] = useState(null); // { id, before }
  const dragIdRef = useRef(null);

  const sorted = [...playlists].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return (a.sortIndex ?? a.createdAt) - (b.sortIndex ?? b.createdAt);
  });

  function finalizeDrop() {
    const draggedId = dragIdRef.current;
    const dt = dropTarget;
    dragIdRef.current = null;
    setDropTarget(null);
    if (draggedId && dt && dt.id !== draggedId) {
      onReorderPlaylists(draggedId, dt.id, dt.before);
    }
  }

  function submitNew(e) {
    e.preventDefault();
    const name = newName.trim();
    if (name) onCreatePlaylist(name);
    setNewName('');
    setCreating(false);
  }

  function submitRename(e) {
    e.preventDefault();
    const name = renameValue.trim();
    if (name && renamingId) onRenamePlaylist(renamingId, name);
    setRenamingId(null);
    setRenameValue('');
  }

  function playlistMenu(e, pl) {
    e.preventDefault();
    onOpenMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Play', onClick: () => onPlayPlaylist(pl.id) },
        { label: pl.pinned ? 'Unpin' : 'Pin to top', onClick: () => onTogglePin(pl.id) },
        {
          label: 'Rename',
          onClick: () => {
            setRenamingId(pl.id);
            setRenameValue(pl.name);
          }
        },
        { separator: true },
        {
          label: 'Delete playlist',
          danger: true,
          onClick: () => {
            if (confirm(`Delete playlist "${pl.name}"? Your songs stay in the library.`)) {
              onDeletePlaylist(pl.id);
            }
          }
        }
      ]
    });
  }

  return (
    <div className="playlist-nav">
      <UploadButton onFilesSelected={onFilesSelected} />

      <button
        className={`nav-item${activeView.type === 'imported' ? ' active' : ''}`}
        onClick={() => onSelectView({ type: 'imported' })}
      >
        Imported
      </button>

      <div className="nav-section-label">playlists</div>

      <div className="playlist-list">
        {sorted.map((pl) =>
          renamingId === pl.id ? (
            <form key={pl.id} onSubmit={submitRename} className="playlist-rename-form">
              <input
                autoFocus
                className="playlist-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
              />
            </form>
          ) : (
            <div
              key={pl.id}
              className={`playlist-item-row${pl.pinned ? ' pinned' : ''}${
                activeView.type === 'playlist' && activeView.id === pl.id ? ' active' : ''
              }`}
              draggable
              onDragStart={(e) => {
                dragIdRef.current = pl.id;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                const dragged = playlists.find((p) => p.id === dragIdRef.current);
                // only reorder within the same pinned / unpinned group
                if (!dragged || dragged.id === pl.id || !!dragged.pinned !== !!pl.pinned) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                setDropTarget({ id: pl.id, before });
              }}
              onDrop={(e) => {
                e.preventDefault();
                finalizeDrop();
              }}
              onDragEnd={() => {
                dragIdRef.current = null;
                setDropTarget(null);
              }}
            >
              {dropTarget && dropTarget.id === pl.id && (
                <div className={`playlist-drop-line ${dropTarget.before ? 'top' : 'bottom'}`} />
              )}
              <button
                className="playlist-item"
                onClick={() => onSelectView({ type: 'playlist', id: pl.id })}
                onContextMenu={(e) => playlistMenu(e, pl)}
                title={pl.name}
              >
                <span className="playlist-item-name">{pl.name}</span>
              </button>
              <button
                className="playlist-pin-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(pl.id);
                }}
                title={pl.pinned ? 'Unpin' : 'Pin to top'}
                aria-label={pl.pinned ? 'unpin playlist' : 'pin playlist to top'}
                aria-pressed={!!pl.pinned}
              >
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path
                    d="M9.6 1.6 14.4 6.4l-2.9 1-1.4 4.1-2.4-2.5-3.9 4-.7-.7 4-3.9L2.5 6l4.1-1.4z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <span className="playlist-item-count">{pl.trackIds.length}</span>
            </div>
          )
        )}

        {creating ? (
          <form onSubmit={submitNew} className="playlist-rename-form">
            <input
              autoFocus
              className="playlist-rename-input"
              placeholder="playlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={submitNew}
            />
          </form>
        ) : (
          <button className="new-playlist" onClick={() => setCreating(true)}>
            + new playlist
          </button>
        )}
      </div>

      <div className="nav-panels">
        <QueuePanel
          queue={queue}
          tracks={tracks}
          onRemoveFromQueue={onRemoveFromQueue}
          onReorderQueue={onReorderQueue}
          onClearQueue={onClearQueue}
        />
        <HistoryPanel
          history={history}
          historyIndex={historyIndex}
          tracks={tracks}
          onJumpToHistory={onJumpToHistory}
          onClearHistory={onClearHistory}
        />
      </div>

      <div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
    </div>
  );
}

export default memo(PlaylistNav);
