import { memo, useEffect, useMemo, useRef, useState } from 'react';
import TrackItem from './TrackItem';
import TagMenu from './TagMenu';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useListSelection } from '../lib/useListSelection';

function formatTotal(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function GridItem({
  track,
  index = 0,
  isActive,
  isPlayingTrack,
  isSelected,
  onSelect,
  onMouseDownItem,
  onMouseOverItem,
  onPlay,
  onContextMenu
}) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  return (
    <div
      className={`grid-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
      // staggered entry delay — capped so a big library still finishes fast
      style={{ '--stagger': `${Math.min(index, 26) * 13}ms` }}
      data-sel-id={track.id}
      onMouseDown={(e) => onMouseDownItem(track.id, e)}
      onMouseOver={() => onMouseOverItem(track.id)}
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
function LibraryList({
  tracks, // already resolved + ordered for the active view
  viewTitle,
  isPlaylistView,
  playlistId,
  playlistDescription = '',
  playlistImageBlob = null,
  onEditPlaylist,
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
  onPrompt,
  onAddVersion,
  onOpenVersions,
  missingPaths,
  searchInputRef
}) {
  const playlistImageUrl = useObjectUrl(playlistImageBlob);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [bulkTagMenu, setBulkTagMenu] = useState(null); // 'add' | 'remove' | null
  const [dropIndex, setDropIndex] = useState(null);
  const dragIndexRef = useRef(null);
  const bulkAddRef = useRef(null);
  const bulkRemoveRef = useRef(null);

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
        !q ||
        t.artist.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.versions || []).some((v) => v.title && v.title.toLowerCase().includes(q));
      const matchesTag = !activeTag || t.tags.includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [tracks, query, activeTag]);

  const reorderEnabled = isPlaylistView && !query && !activeTag && viewMode === 'list';

  const totalSeconds = useMemo(
    () => visibleTracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [visibleTracks]
  );

  const {
    selectedIds,
    setSelectedIds,
    clearSelection,
    onItemMouseDown,
    onItemMouseOver,
    onItemClick
  } = useListSelection(() => visibleTracks.map((t) => t.id));

  // clear selection when the view changes out from under it
  useEffect(() => {
    clearSelection();
  }, [viewTitle, isPlaylistView, clearSelection]);

  function handleClick(id, e) {
    if (onItemClick(id, e) === 'plain') onSelectTrack(id);
  }

  // right-click target: the whole selection if the clicked row is part of a
  // multi-selection, otherwise just that one track (in list order)
  function menuTargets(trackId) {
    if (selectedIds.has(trackId) && selectedIds.size > 1) {
      return visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);
    }
    return [trackId];
  }

  // a row's own `+ tag` menu: if that row is part of a multi-selection, the
  // pick lands on every selected track, otherwise just that one
  function handleRowAddTag(trackId, tag) {
    menuTargets(trackId).forEach((id) => onAddTag(id, tag));
  }

  // the row's "×" button — same "whole selection vs. just this row" logic
  // as the right-click menu (menuTargets above), so deleting/removing via
  // × while several tracks are highlighted acts on all of them, not just
  // the one row you happened to click
  function handleRowDelete(trackId) {
    const ids = menuTargets(trackId);
    const many = ids.length > 1;
    if (isPlaylistView) {
      // × just takes the song(s) out of THIS playlist — stays in the
      // library, so no confirm (matches the single-track behavior before)
      ids.forEach((id) => onRemoveTrackFromPlaylist(playlistId, id));
      setSelectedIds(new Set());
      return;
    }
    const label = many ? `${ids.length} tracks` : `"${visibleTracks.find((t) => t.id === trackId)?.title}"`;
    if (confirm(`Delete ${label} from your library? This can't be undone.`)) {
      ids.forEach((id) => onDeleteTrack(id));
      setSelectedIds(new Set());
    }
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
          onPrompt({
            title: `New playlist from ${ids.length} ${ids.length === 1 ? 'track' : 'tracks'}`,
            placeholder: 'Playlist name',
            onSubmit: (name) => {
              onCreatePlaylistWithTracks(name, ids);
              setSelectedIds(new Set());
            }
          });
        }
      }
    ];

    const items = [];
    if (!many) items.push({ label: 'Play', onClick: () => onPlayTrack(trackId) });
    if (!many && onAddVersion) {
      items.push({ label: 'Add version…', onClick: () => onAddVersion(trackId) });
      items.push({ label: 'Versions & notes…', onClick: () => onOpenVersions(trackId) });
      items.push({ separator: true });
    }
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
  const selectedInOrder = () => visibleTracks.filter((t) => selectedIds.has(t.id)).map((t) => t.id);

  // every tag currently on at least one selected track (for the bulk "− tag"
  // menu). Recomputed live, so as tags are removed the menu shrinks.
  const selectionTags = useMemo(() => {
    const set = new Set();
    visibleTracks.forEach((t) => {
      if (selectedIds.has(t.id)) t.tags.forEach((tg) => set.add(tg));
    });
    return [...set].sort();
  }, [visibleTracks, selectedIds]);

  function bulkAddTag(tag) {
    selectedInOrder().forEach((id) => onAddTag(id, tag));
  }
  function bulkRemoveTag(tag) {
    selectedInOrder().forEach((id) => onRemoveTag(id, tag));
  }

  const showHero = isPlaylistView && (playlistImageBlob || playlistDescription);

  const viewToggle = (
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
  );

  const subtitle = (
    <>
      {visibleTracks.length} {visibleTracks.length === 1 ? 'song' : 'songs'}
      {totalSeconds > 0 && ` · ${formatTotal(totalSeconds)}`}
    </>
  );

  return (
    <div className="library-list">
      {showHero ? (
        <div className="playlist-hero">
          {playlistImageUrl && (
            <div
              className="playlist-hero-cover"
              style={{ backgroundImage: `url(${playlistImageUrl})` }}
              role={onEditPlaylist ? 'button' : undefined}
              onClick={onEditPlaylist}
              title={onEditPlaylist ? 'edit playlist' : undefined}
            />
          )}
          <div className="playlist-hero-text">
            <h1 className="lib-title">{viewTitle}</h1>
            {playlistDescription && (
              <p className="playlist-hero-desc" title={playlistDescription}>
                {playlistDescription}
              </p>
            )}
            <p className="lib-subtitle">{subtitle}</p>
          </div>
          <div className="playlist-hero-actions">
            {onEditPlaylist && (
              <button className="playlist-hero-edit" onClick={onEditPlaylist}>
                edit
              </button>
            )}
            {viewToggle}
          </div>
        </div>
      ) : (
        <div className="lib-header">
          <div className="lib-title-block">
            <h1 className="lib-title">{viewTitle}</h1>
            <p className="lib-subtitle">{subtitle}</p>
          </div>
          {viewToggle}
        </div>
      )}

      <input
        ref={searchInputRef}
        className="search-input"
        placeholder="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // first Escape clears a query, a second (or Escape on an empty
            // field) drops focus back to the app
            e.stopPropagation();
            if (query) setQuery('');
            else e.currentTarget.blur();
          }
        }}
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
          <button
            ref={bulkAddRef}
            className={`bulk-btn${bulkTagMenu === 'add' ? ' active' : ''}`}
            onClick={() => setBulkTagMenu((m) => (m === 'add' ? null : 'add'))}
          >
            + tag
          </button>
          {selectionTags.length > 0 && (
            <button
              ref={bulkRemoveRef}
              className={`bulk-btn${bulkTagMenu === 'remove' ? ' active' : ''}`}
              onClick={() => setBulkTagMenu((m) => (m === 'remove' ? null : 'remove'))}
            >
              − tag
            </button>
          )}
          {bulkTagMenu === 'add' && (
            <TagMenu
              anchorEl={bulkAddRef.current}
              mode="add"
              options={allTags}
              onPick={bulkAddTag}
              onClose={() => setBulkTagMenu(null)}
              note={`adding to ${selectedIds.size} songs`}
            />
          )}
          {bulkTagMenu === 'remove' && (
            <TagMenu
              anchorEl={bulkRemoveRef.current}
              mode="remove"
              options={selectionTags}
              onPick={bulkRemoveTag}
              onClose={() => setBulkTagMenu(null)}
              note={`removing from ${selectedIds.size} songs`}
            />
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
                      const ids = selectedInOrder();
                      onPrompt({
                        title: `New playlist from ${ids.length} tracks`,
                        placeholder: 'Playlist name',
                        onSubmit: (name) => {
                          onCreatePlaylistWithTracks(name, ids);
                          setSelectedIds(new Set());
                        }
                      });
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
          <button className="bulk-btn" onClick={clearSelection}>
            clear
          </button>
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="track-grid view-swap">
          {visibleTracks.map((track, index) => (
            <GridItem
              key={track.id}
              index={index}
              track={track}
              isActive={track.id === currentTrackId}
              isPlayingTrack={track.id === playingTrackId}
              isSelected={selectedIds.has(track.id)}
              onSelect={handleClick}
              onMouseDownItem={onItemMouseDown}
              onMouseOverItem={onItemMouseOver}
              onPlay={onPlayTrack}
              onContextMenu={openTrackMenu}
            />
          ))}
          {visibleTracks.length === 0 && <p className="empty-state">nothing here yet.</p>}
        </div>
      ) : (
        <div className="track-list view-swap">
          {visibleTracks.map((track, index) => (
            <div
              key={track.id}
              className="lib-row-wrap"
              data-sel-id={track.id}
              onMouseOver={() => onItemMouseOver(track.id)}
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
                position={index + 1}
                isActive={track.id === currentTrackId}
                isPlayingTrack={track.id === playingTrackId}
                isExpanded={track.id === expandedTrackId}
                isSelected={selectedIds.has(track.id)}
                onSelect={handleClick}
                onPlay={onPlayTrack}
                onMouseDownTrack={onItemMouseDown}
                onContextMenuTrack={openTrackMenu}
                onAddTag={handleRowAddTag}
                onRemoveTag={onRemoveTag}
                allTags={allTags}
                multiTagCount={
                  selectedIds.has(track.id) && selectedIds.size > 1 ? selectedIds.size : 0
                }
                onRowAction={handleRowDelete}
                inPlaylist={isPlaylistView}
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

export default memo(LibraryList);
