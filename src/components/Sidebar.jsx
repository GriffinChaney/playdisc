import { useEffect, useMemo, useRef, useState } from 'react';
import UploadButton from './UploadButton';
import TrackItem from './TrackItem';

export default function Sidebar({
  tracks,
  currentTrackId,
  playingTrackId,
  expandedTrackId,
  onSelectTrack,
  onPlayTrack,
  onFilesSelected,
  onAddTag,
  onRemoveTag,
  onDeleteTagGroup,
  onDeleteTrack,
  queue,
  onAddToQueue,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
  searchInputRef,
  onResizeStart
}) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [addingBulkTag, setAddingBulkTag] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  // dropIndicatorIndex is "insert before this index" (0..queue.length),
  // recomputed from cursor position within whatever row is under the
  // pointer — precise enough to land exactly between two songs, instead of
  // the old whole-row drop target that was hard to aim at.
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(null);
  const dragQueueIndexRef = useRef(null);

  function finalizeQueueDrop() {
    const from = dragQueueIndexRef.current;
    const insertBefore = dropIndicatorIndex;
    dragQueueIndexRef.current = null;
    setDropIndicatorIndex(null);
    if (from === null || insertBefore === null) return;
    if (insertBefore === from || insertBefore === from + 1) return; // no-op drop
    onReorderQueue(from, insertBefore);
  }
  // 'add' | 'remove' | null — set on cmd+mousedown and consulted by
  // onMouseEnter while the button stays down, so dragging across rows
  // paints the selection the way Finder's cmd-drag does.
  const dragModeRef = useRef(null);

  const allTags = useMemo(() => {
    const set = new Set();
    tracks.forEach((t) => t.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [tracks]);

  const visibleTracks = useMemo(() => {
    return tracks
      .filter((t) => {
        const matchesQuery =
          !query ||
          t.title.toLowerCase().includes(query.toLowerCase()) ||
          t.artist.toLowerCase().includes(query.toLowerCase());
        const matchesTag = !activeTag || t.tags.includes(activeTag);
        return matchesQuery && matchesTag;
      })
      .sort((a, b) => b.dateAdded - a.dateAdded); // newest added first
  }, [tracks, query, activeTag]);

  // Escape clears an active multi-selection.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setSelectedIds(new Set());
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.size]);

  // ends a cmd-drag selection wherever the mouse is released
  useEffect(() => {
    function handleMouseUp() {
      dragModeRef.current = null;
    }
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  function handleTrackMouseDown(id, e) {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault(); // avoid native text-selection while dragging
    const alreadySelected = selectedIds.has(id);
    dragModeRef.current = alreadySelected ? 'remove' : 'add';
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (alreadySelected) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  }

  function handleTrackMouseEnter(id) {
    if (!dragModeRef.current) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (dragModeRef.current === 'add') next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleTrackClick(id, e) {
    if (e.metaKey || e.ctrlKey) return; // handled by mousedown/mouseenter above
    if (e.shiftKey && lastClickedId) {
      const ids = visibleTracks.map((t) => t.id);
      const startIdx = ids.indexOf(lastClickedId);
      const endIdx = ids.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        setSelectedIds((prev) => new Set([...prev, ...ids.slice(from, to + 1)]));
      }
      return;
    }
    // plain click: clear any multi-selection and just select this track
    // (loads it into the player, but doesn't start playback — hit play/space for that)
    setSelectedIds(new Set());
    setLastClickedId(id);
    onSelectTrack(id);
  }

  function handleBulkDelete() {
    if (confirm(`Delete ${selectedIds.size} selected tracks? This can't be undone.`)) {
      selectedIds.forEach((id) => onDeleteTrack(id));
      setSelectedIds(new Set());
    }
  }

  function submitBulkTag(e) {
    e.preventDefault();
    const value = bulkTagInput.trim();
    if (value) selectedIds.forEach((id) => onAddTag(id, value));
    setBulkTagInput('');
    setAddingBulkTag(false);
  }

  return (
    <div className="sidebar">
      <UploadButton onFilesSelected={onFilesSelected} />

      <input
        ref={searchInputRef}
        className="search-input"
        placeholder="search library"
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

      <p className="library-count">library — {tracks.length} tracks</p>

      {queue.length > 0 && (
        <div className="queue-panel">
          <div className="queue-panel-header">
            <p className="queue-label">up next — {queue.length}</p>
            <button className="queue-clear-btn" onClick={onClearQueue}>
              clear
            </button>
          </div>
          <div
            className="queue-drop-zone"
            onDragOver={(e) => {
              if (e.target !== e.currentTarget || dragQueueIndexRef.current === null) return;
              e.preventDefault();
              setDropIndicatorIndex(queue.length);
            }}
            onDrop={(e) => {
              if (dragQueueIndexRef.current === null) return;
              e.preventDefault();
              finalizeQueueDrop();
            }}
          >
            {queue.map((entry, index) => {
              const t = tracks.find((tr) => tr.id === entry.trackId);
              if (!t) return null;
              const isLast = index === queue.length - 1;
              return (
                <div key={entry.qid} className="queue-item-wrap">
                  {/* absolutely positioned so it never nudges row layout — a
                      flow-affecting indicator shifted rows under the cursor
                      as it appeared/moved, which is what made drops land on
                      the wrong song */}
                  {dropIndicatorIndex === index && <div className="queue-drop-line top" />}
                  <div
                    className="queue-item"
                    draggable
                    onDragStart={(e) => {
                      dragQueueIndexRef.current = index;
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragQueueIndexRef.current === null) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setDropIndicatorIndex(before ? index : index + 1);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      finalizeQueueDrop();
                    }}
                    onDragEnd={() => {
                      dragQueueIndexRef.current = null;
                      setDropIndicatorIndex(null);
                    }}
                  >
                    <span className="queue-drag-handle" aria-hidden="true">
                      ⠿
                    </span>
                    <span className="queue-item-title">{t.title}</span>
                    <button
                      className="queue-item-remove"
                      onClick={() => onRemoveFromQueue(entry.qid)}
                      aria-label={`remove ${t.title} from queue`}
                    >
                      ×
                    </button>
                  </div>
                  {isLast && dropIndicatorIndex === queue.length && <div className="queue-drop-line bottom" />}
                </div>
              );
            })}
          </div>
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
          <button className="bulk-btn danger" onClick={handleBulkDelete}>
            delete
          </button>
          <button className="bulk-btn" onClick={() => setSelectedIds(new Set())}>
            clear
          </button>
        </div>
      )}

      <div className="track-list">
        {visibleTracks.map((track) => (
          <TrackItem
            key={track.id}
            track={track}
            isActive={track.id === currentTrackId}
            isPlayingTrack={track.id === playingTrackId}
            isExpanded={track.id === expandedTrackId}
            isSelected={selectedIds.has(track.id)}
            onSelect={handleTrackClick}
            onPlay={onPlayTrack}
            onMouseDownTrack={handleTrackMouseDown}
            onMouseEnterTrack={handleTrackMouseEnter}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            onDelete={onDeleteTrack}
            onAddToQueue={onAddToQueue}
          />
        ))}
        {visibleTracks.length === 0 && <p className="empty-state">no tracks match yet.</p>}
      </div>
      <div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
    </div>
  );
}
