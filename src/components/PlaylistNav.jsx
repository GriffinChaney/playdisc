import { useState } from 'react';
import UploadButton from './UploadButton';
import QueuePanel from './QueuePanel';
import HistoryPanel from './HistoryPanel';

// Left column of the library view: upload, the "Imported" (whole-library)
// view, the playlist list (pinned first), a new-playlist affordance, then
// the queue and recently-played panels.
export default function PlaylistNav({
  playlists,
  activeView,
  onSelectView,
  onFilesSelected,
  onCreatePlaylist,
  onOpenMenu,
  onTogglePin,
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

  const sorted = [...playlists].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return a.createdAt - b.createdAt;
  });

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
            <button
              key={pl.id}
              className={`playlist-item${
                activeView.type === 'playlist' && activeView.id === pl.id ? ' active' : ''
              }`}
              onClick={() => onSelectView({ type: 'playlist', id: pl.id })}
              onContextMenu={(e) => playlistMenu(e, pl)}
              title={pl.name}
            >
              {pl.pinned && (
                <span className="playlist-pin" aria-label="pinned">
                  ▲
                </span>
              )}
              <span className="playlist-item-name">{pl.name}</span>
              <span className="playlist-item-count">{pl.trackIds.length}</span>
            </button>
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
