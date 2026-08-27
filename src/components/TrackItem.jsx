import { useState } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';

function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function TrackItem({
  track,
  isActive,
  isPlayingTrack,
  isExpanded,
  isSelected,
  onSelect,
  onPlay,
  onMouseDownTrack,
  onMouseEnterTrack,
  onContextMenuTrack,
  onAddTag,
  onRemoveTag,
  onDelete,
  onAddToQueue
}) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');

  function submitTag(e) {
    e.preventDefault();
    const value = tagInput.trim();
    if (value) onAddTag(track.id, value);
    setTagInput('');
    setAddingTag(false);
  }

  function handleDelete(e) {
    e.stopPropagation();
    if (confirm(`Delete "${track.title}"? This can't be undone.`)) {
      onDelete(track.id);
    }
  }

  return (
    <div
      className={`track-item${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}${isSelected ? ' selected' : ''}`}
      onClick={(e) => onSelect(track.id, e)}
      onDoubleClick={() => onPlay(track.id)}
      onContextMenu={(e) => onContextMenuTrack?.(e, track.id)}
      onMouseDown={(e) => onMouseDownTrack(track.id, e)}
      onMouseEnter={() => onMouseEnterTrack(track.id)}
    >
      <div className="track-thumb" style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}>
        {!artworkUrl && <span className="thumb-fallback">♪</span>}
      </div>
      <div className="track-meta">
        <p className="track-title">
          {isPlayingTrack && <span className="now-playing-dot" aria-label="now playing" />}
          {track.title}
        </p>
        <p className="track-artist">{track.artist}</p>
        <div className="track-tags" onClick={(e) => e.stopPropagation()}>
          {track.tags.map((tag) => (
            <span className="tag-chip" key={tag}>
              {tag}
              <button
                className="tag-remove-btn"
                onClick={() => onRemoveTag(track.id, tag)}
                aria-label={`remove tag ${tag}`}
              >
                ✕
              </button>
            </span>
          ))}
          {addingTag ? (
            <form onSubmit={submitTag} style={{ display: 'inline' }}>
              <input
                autoFocus
                className="tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={() => setAddingTag(false)}
                placeholder="tag name"
              />
            </form>
          ) : (
            <button className="tag-add-btn" onClick={() => setAddingTag(true)}>
              + tag
            </button>
          )}
        </div>
      </div>
      <span className="track-duration">{formatDuration(track.duration)}</span>
      <button
        className="track-queue-btn"
        onClick={(e) => {
          e.stopPropagation();
          onAddToQueue(track.id);
        }}
        aria-label={`add ${track.title} to queue`}
        title="add to queue"
      >
        +
      </button>
      <button className="track-delete-btn" onClick={handleDelete} aria-label={`delete ${track.title}`}>
        ✕
      </button>
    </div>
  );
}
