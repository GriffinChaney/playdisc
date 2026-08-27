import { useEffect, useRef, useState } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { qualityChips, qualityTier } from '../lib/audioQuality';

function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function formatDate(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatSize(bytes = 0) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

const MIME_LABEL = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/aac': 'AAC',
  'audio/ogg': 'OGG'
};

function formatType(blob) {
  if (!blob?.type) return null;
  return MIME_LABEL[blob.type] || blob.type.replace(/^audio\//, '').toUpperCase();
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
  onContextMenuTrack,
  onAddTag,
  onRemoveTag,
  onDelete,
  onRemoveFromPlaylist,
  inPlaylist,
  onAddToQueue
}) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  const rowRef = useRef(null);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // when the zoom lands on this row (via Z, or following next/prev), keep it
  // on screen
  useEffect(() => {
    if (!isExpanded) return;
    // instant + 'nearest' — no-op when the row is already visible. A smooth
    // scroll here would re-fire against a container whose height is changing
    // (the row is growing) and could churn hard enough to lock the window.
    const id = requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [isExpanded]);

  function submitTag(e) {
    e.preventDefault();
    const value = tagInput.trim();
    if (value) onAddTag(track.id, value);
    setTagInput('');
    setAddingTag(false);
  }

  function handleRowAction(e) {
    e.stopPropagation();
    if (inPlaylist) {
      // in a playlist the × just takes the song out of THIS playlist —
      // it stays in the library, so no confirm
      onRemoveFromPlaylist(track.id);
      return;
    }
    if (confirm(`Delete "${track.title}"? This can't be undone.`)) {
      onDelete(track.id);
    }
  }

  return (
    <div
      ref={rowRef}
      className={`track-item${isActive ? ' active' : ''}${isExpanded ? ' expanded' : ''}${isSelected ? ' selected' : ''}`}
      onClick={(e) => onSelect(track.id, e)}
      onDoubleClick={() => onPlay(track.id)}
      onContextMenu={(e) => onContextMenuTrack?.(e, track.id)}
      onMouseDown={(e) => onMouseDownTrack(track.id, e)}
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
        {isExpanded && (
          <div className="track-expanded-info">
            {qualityTier(track.audio) && (
              <span className={`track-info-chip quality-${qualityTier(track.audio)}`}>
                {qualityTier(track.audio)}
              </span>
            )}
            {[
              ...qualityChips(track.audio),
              qualityChips(track.audio).length ? null : formatType(track.audioBlob),
              formatSize(track.audioBlob?.size),
              formatDate(track.dateAdded) && `added ${formatDate(track.dateAdded)}`,
              formatDuration(track.duration),
              track.tags.length
                ? `${track.tags.length} tag${track.tags.length > 1 ? 's' : ''}`
                : null
            ]
              .filter(Boolean)
              .map((line, i) => (
                <span key={i} className="track-info-chip">
                  {line}
                </span>
              ))}
          </div>
        )}
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
      <button
        className="track-delete-btn"
        onClick={handleRowAction}
        aria-label={
          inPlaylist ? `remove ${track.title} from playlist` : `delete ${track.title} from library`
        }
        title={inPlaylist ? 'remove from playlist' : 'delete from library'}
      >
        ✕
      </button>
    </div>
  );
}
