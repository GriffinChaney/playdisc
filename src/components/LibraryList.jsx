import { useEffect, useMemo, useRef, useState } from 'react';
import TrackItem from './TrackItem';
import { useObjectUrl } from '../lib/useObjectUrl';

function formatTotal(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function GridItem({ track, isActive, isPlayingTrack, isSelected, onSelect, onPlay, onContextMenu }) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  return (
    <div
      className={`grid-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
      onClick={(e) => onSelect(track.id, e)}
      onDoubleClick={() => onPlay(track.id)}
      onContextMenu={(e) => onContextMenu(e, track.id)}
      title={`${track.title} — ${track.artist}`}
    >
      <div
        className="grid-cover"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="thumb-fallback">♪</span>}
      </div>
      <p className="grid-title">
        {isPlayingTrack && <span className="now-playing-dot" aria-label="now playing" />}
        {track.title}
      </p>
      <p className="grid-artist">{track.artist}</p>
    </div>
  );
}

// Middle column of the library view: header (title / count / total time /
// list-grid toggle), search + tag filter, the track list or grid, the
// multi-select bulk bar, and (in an unfiltered playlist view) drag-to-reorder.
export default function LibraryList({
  tracks, // already resolved + ordered for the active view
  viewTitle,
  isPlaylistView,
  playlistId,
  playlists,
  currentTrackId,
  playingTrackId,
  expandedTrackId,
  viewMode,
  onSetViewMode,
  onSelectTrack,
  onPlayTrack,
  onAddTag,
  onRemoveTag,
  onDeleteTagGroup,
  onDeleteTrack,
  onAddToQueue,
  onAddTracksToPlaylist,
  onCreatePlaylistWithTracks,
  onRemoveTrackFromPlaylist,
  onReorderPlaylistTracks,
  onOpenMenu,
  searchInputRef
}) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [addingBulkTag, setAddingBulkTag] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [dropIndex, setDropIndex] = useState(null);
  const dragIndexRef = useRef(null);
  const dragModeRef = useRef(null); // 'add' | 'remove' | null (cmd-drag select)

  const allTags = useMemo(() => {
    const set = new Set();
    tracks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [tracks]);

  // search + tag filter. Playlist views keep their manual order; the Imported
  // view keeps the newest-first order it arrives in.
  const visibleTracks = useMemo(() => {
    const q = query.toLowerCase();
    return tracks.filter((t) => {
      const matchesQuery =
        !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
      const matchesTag = !activeTag || t.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [tracks, query, activeTag]);

  const reorderEnabled = isPlaylistView && !query && !activeTag && viewMode === 'list';

  const totalSeconds = useMemo(
    () => visibleTracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [visibleTracks]
  );

  useEffect(() => {
    if (selectedIds.size === 0) return;
    function onKey(e) {
      if (e.key === 'Escape') setSelectedIds(new Set());
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedIds.size]);

  useEffect(() => {
    function onUp() {
      dragModeRef.current = null;
    }
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // clear selection when the view changes out from under it
  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [viewTitle, isPlaylistView]);

  function handleMouseDown(id, e) {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    const already = selectedIds.has(id);
    dragModeRef.current = already ? 'remove' : 'add';
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (already) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  }

  function handleMouseEnter(id) {
    if (!dragModeRef.current) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (dragModeRef.current === 'add') next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleClick(id, e) {
    if (e.metaKey || e.ctrlKey) return;
    if (e.shiftKey && lastClickedId) {
      const ids = visibleTracks.map((t) => t.id);
      const a = ids.indexOf(lastClickedId);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => new Set([...prev, ...ids.slice(from, to + 1)]));
      }
      return;
    }
    setSelectedIds(new Set());
    setLastClickedId(id);
    onSelectTrack(id);
  }

  // right-click target: the whole selection if the clicked row is part of a
  // multi-selection, otherwise just that one track (in list order)
  function menuTargets(trackId) {
    if (selectedIds.has(trackId) && selectedIds.size > 1) {
      return visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);
    }
    return [trackId];
  }

  function openTrackMenu(e, trackId) {
    e.preventDefault();
    const ids = menuTargets(trackId);
    const many = ids.length > 1;
    const label = many ? `${ids.length} tracks` : 'track';

    const addToPlaylistSub = [
      ...playlists.map((pl) => ({
        label: pl.name,
        onClick: () => {
          onAddTracksToPlaylist(pl.id, ids);
          setSelectedIds(new Set());
        }
      })),
      ...(playlists.length ? [{ separator: true }] : []),
      {
        label: 'New playlist…',
        onClick: () => {
          const name = prompt('New playlist name');
          if (name && name.trim()) {
            onCreatePlaylistWithTracks(name.trim(), ids);
            setSelectedIds(new Set());
          }
        }
      }
    ];

    const items = [];
    if (!many) items.push({ label: 'Play', onClick: () => onPlayTrack(trackId) });
    items.push({
      label: many ? `Add ${label} to queue` : 'Add to queue',
      onClick: () => {
        ids.forEach((id) => onAddToQueue(id));
        setSelectedIds(new Set());
      }
    });
    items.push({ label: `Add ${many ? label + ' ' : ''}to playlist`, submenu: addToPlaylistSub });
    if (isPlaylistView) {
      items.push({
        label: 'Remove from this playlist',
        onClick: () => {
          ids.forEach((id) => onRemoveTrackFromPlaylist(playlistId, id));
          setSelectedIds(new Set());
        }
      });
    }
    items.push({ separator: true });
    items.push({
      label: many ? `Delete ${label} from library` : 'Delete from library',
      danger: true,
      onClick: () => {
        if (confirm(`Delete ${many ? ids.length + ' tracks' : `"${visibleTracks.find((t) => t.id === trackId)?.title}"`} from your library? This can't be undone.`)) {
          ids.forEach((id) => onDeleteTrack(id));
          setSelectedIds(new Set());
        }
      }
    });

    onOpenMenu({ x: e.clientX, y: e.clientY, items });
  }

  function finalizeReorder() {
    const from = dragIndexRef.current;
    const before = dropIndex;
    dragIndexRef.current = null;
    setDropIndex(null);
    if (from === null || before === null) return;
    if (before === from || before === from + 1) return;
    onReorderPlaylistTracks(playlistId, from, before);
  }

  function handleBulkDelete() {
    if (confirm(`Delete ${selectedIds.size} selected tracks? This can't be undone.`)) {
      selectedIds.forEach((id) => onDeleteTrack(id));
      setSelectedIds(new Set());
    }
  }
  function handleBulkQueue() {
    visibleTracks.forEach((t) => selectedIds.has(t.id) && onAddToQueue(t.id));
    setSelectedIds(new Set());
  }
  function submitBulkTag(e) {
    e.preventDefault();
    const v = bulkTagInput.trim();
    if (v) selectedIds.forEach((id) => onAddTag(id, v));
    setBulkTagInput('');
    setAddingBulkTag(false);
  }

  const selectedInOrder = () => visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);

  return (
    <div className="library-list">
      <div className="lib-header">
        <div className="lib-title-block">
          <h1 className="lib-title">{viewTitle}</h1>
          <p className="lib-subtitle">
            {visibleTracks.length} {visibleTracks.length === 1 ? 'song' : 'songs'}
            {totalSeconds > 0 && ` · ${formatTotal(totalSeconds)}`}
          </p>
        </div>
        <div className="view-toggle">
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => onSetViewMode('list')}
            aria-label="list view"
            title="list view"
          >
            ☰
          </button>
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => onSetViewMode('grid')}
            aria-label="grid view"
            title="grid view"
          >
            ▦
          </button>
        </div>
      </div>

      <input
        ref={searchInputRef}
        className="search-input"
        placeholder="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {allTags.length > 0 && (
        <div className="tag-filter">
          <button className={!activeTag ? 'active' : ''} onClick={() => setActiveTag(null)}>
            all
          </button>
          {allTags.map((tag) => (
            <span key={tag} className={`tag-filter-item${activeTag === tag ? ' active' : ''}`}>
              <button className="tag-filter-select" onClick={() => setActiveTag(tag)}>
                {tag}
              </button>
              <button
                className="tag-filter-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete tag "${tag}" from all tracks?`)) {
                    if (activeTag === tag) setActiveTag(null);
                    onDeleteTagGroup(tag);
                  }
                }}
                aria-label={`delete tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selectedIds.size} selected</span>
          {addingBulkTag ? (
            <form onSubmit={submitBulkTag} style={{ display: 'inline' }}>
              <input
                autoFocus
                className="tag-input"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                onBlur={() => setAddingBulkTag(false)}
                placeholder="tag name"
              />
            </form>
          ) : (
            <button className="bulk-btn" onClick={() => setAddingBulkTag(true)}>
              + tag
            </button>
          )}
          <button className="bulk-btn" onClick={handleBulkQueue}>
            + queue
          </button>
          <button
            className="bulk-btn"
            onClick={(e) =>
              onOpenMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  ...playlists.map((pl) => ({
                    label: pl.name,
                    onClick: () => {
                      onAddTracksToPlaylist(pl.id, selectedInOrder());
                      setSelectedIds(new Set());
                    }
                  })),
                  ...(playlists.length ? [{ separator: true }] : []),
                  {
                    label: 'New playlist…',
                    onClick: () => {
                      const name = prompt('New playlist name');
                      if (name && name.trim()) {
                        onCreatePlaylistWithTracks(name.trim(), selectedInOrder());
                        setSelectedIds(new Set());
                      }
                    }
                  }
                ]
              })
            }
          >
            + playlist
          </button>
          <button className="bulk-btn danger" onClick={handleBulkDelete}>
            delete
          </button>
          <button className="bulk-btn" onClick={() => setSelectedIds(new Set())}>
            clear
          </button>
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="track-grid">
          {visibleTracks.map((track) => (
            <GridItem
              key={track.id}
              track={track}
              isActive={track.id === currentTrackId}
              isPlayingTrack={track.id === playingTrackId}
              isSelected={selectedIds.has(track.id)}
              onSelect={handleClick}
              onPlay={onPlayTrack}
              onContextMenu={openTrackMenu}
            />
          ))}
          {visibleTracks.length === 0 && <p className="empty-state">nothing here yet.</p>}
        </div>
      ) : (
        <div className="track-list">
          {visibleTracks.map((track, index) => (
            <div
              key={track.id}
              className="lib-row-wrap"
              draggable={reorderEnabled}
              onDragStart={(e) => {
                if (!reorderEnabled) return;
                dragIndexRef.current = index;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!reorderEnabled || dragIndexRef.current === null) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                setDropIndex(before ? index : index + 1);
              }}
              onDrop={(e) => {
                if (!reorderEnabled) return;
                e.preventDefault();
                finalizeReorder();
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDropIndex(null);
              }}
            >
              {reorderEnabled && dropIndex === index && <div className="lib-drop-line top" />}
              <TrackItem
                track={track}
                isActive={track.id === currentTrackId}
                isPlayingTrack={track.id === playingTrackId}
                isExpanded={track.id === expandedTrackId}
                isSelected={selectedIds.has(track.id)}
                onSelect={handleClick}
                onPlay={onPlayTrack}
                onMouseDownTrack={handleMouseDown}
                onMouseEnterTrack={handleMouseEnter}
                onContextMenuTrack={openTrackMenu}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onDelete={onDeleteTrack}
                onAddToQueue={onAddToQueue}
              />
              {reorderEnabled && index === visibleTracks.length - 1 && dropIndex === visibleTracks.length && (
                <div className="lib-drop-line bottom" />
              )}
            </div>
          ))}
          {visibleTracks.length === 0 && <p className="empty-state">nothing here yet.</p>}
        </div>
      )}
    </div>
  );
}
