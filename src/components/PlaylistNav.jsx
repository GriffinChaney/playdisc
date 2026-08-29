import { memo, useEffect, useRef, useState } from 'react';
import UploadButton from './UploadButton';
import QueuePanel from './QueuePanel';
import HistoryPanel from './HistoryPanel';
import { useListSelection } from '../lib/useListSelection';

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
  onEditPlaylist,
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

  const {
    selectedIds,
    clearSelection,
    onItemMouseDown,
    onItemMouseOver,
    onItemClick
  } = useListSelection(() => sorted.map((p) => p.id));

  function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const names = ids
      .map((id) => playlists.find((p) => p.id === id)?.name)
      .filter(Boolean);
    const msg =
      ids.length === 1
        ? `Delete playlist "${names[0]}"? Your songs stay in the library.`
        : `Delete ${ids.length} playlists? Your songs stay in the library.`;
    if (confirm(msg)) {
      ids.forEach((id) => onDeletePlaylist(id));
      clearSelection();
    }
  }

  // Delete / Backspace removes the multi-selection (when not editing text)
  useEffect(() => {
    if (selectedIds.size === 0) return;
    function onKey(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
        e.preventDefault();
        deleteSelected();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

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
    // if the right-clicked playlist is part of a multi-selection, act on all
    const multi = selectedIds.has(pl.id) && selectedIds.size > 1;
    const items = multi
      ? [
          {
            label: `Delete ${selectedIds.size} playlists`,
            danger: true,
            onClick: deleteSelected
          }
        ]
      : [
          { label: 'Edit…', onClick: () => onEditPlaylist(pl.id) },
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
        ];
    onOpenMenu({ x: e.clientX, y: e.clientY, items });
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
              data-sel-id={pl.id}
              className={`playlist-item-row${pl.pinned ? ' pinned' : ''}${
                activeView.type === 'playlist' && activeView.id === pl.id ? ' active' : ''
              }${selectedIds.has(pl.id) ? ' multi-selected' : ''}`}
              draggable
              onMouseDown={(e) => onItemMouseDown(pl.id, e)}
              onMouseOver={() => onItemMouseOver(pl.id)}
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
                onClick={(e) => {
                  if (onItemClick(pl.id, e) === 'plain') onSelectView({ type: 'playlist', id: pl.id });
                }}
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
