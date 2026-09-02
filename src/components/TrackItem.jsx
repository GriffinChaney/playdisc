import { useEffect, useRef, useState } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { qualityChips, qualityTier } from '../lib/audioQuality';
import TagMenu from './TagMenu';

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
  onRowAction,
  inPlaylist,
  onAddToQueue,
  position,
  allTags = [],
  // when this row is part of a multi-selection, `+ tag` acts on the whole
  // selection (LibraryList wires onAddTag to fan out); show every tag as a
  // candidate and note how many songs it'll hit
  multiTagCount = 0
}) {
  const artworkUrl = useObjectUrl(track.artworkBlob);
  const rowRef = useRef(null);
  const tagBtnRef = useRef(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);

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


  // the parent (LibraryList) decides what "×" actually does — single track
  // vs. the whole highlighted selection, confirm wording, library-delete
  // vs. playlist-remove — since only it knows the current selection
  function handleRowAction(e) {
    e.stopPropagation();
    onRowAction(track.id);
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
      {position != null && <span className="track-index">{position}</span>}
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
        {/* Only the interactive bits in this strip (tag chips, the "+ tag"
            button, and the portaled TagMenu — which stops its own clicks)
            swallow the click. A click on empty space in the strip must fall
            through to the row so it still selects the track — a blanket
            stopPropagation here was eating a fast click that landed in the
            tag row instead of on .track-meta. */}
        <div
          className="track-tags"
          onClick={(e) => {
            if (e.target.closest('.tag-chip, .tag-add-btn')) e.stopPropagation();
          }}
        >
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
          <button
            ref={tagBtnRef}
            className={`tag-add-btn${tagMenuOpen ? ' active' : ''}`}
            onClick={() => setTagMenuOpen((o) => !o)}
          >
            + tag
          </button>
          {tagMenuOpen && (
            <TagMenu
              anchorEl={tagBtnRef.current}
              mode="add"
              options={multiTagCount > 1 ? allTags : allTags.filter((t) => !track.tags.includes(t))}
              onPick={(tag) => onAddTag(track.id, tag)}
              onClose={() => setTagMenuOpen(false)}
              note={multiTagCount > 1 ? `adding to ${multiTagCount} songs` : null}
            />
          )}
        </div>
      </div>
      {(() => {
        const vers = track.versions || [];
        const vtotal = vers.length;
        const notes = track.notes || [];
        const open = notes.filter((n) => !n.complete).length;
        if (vtotal < 2 && notes.length === 0) return null;
        // active version's position (in the modal's date-added order) over total
        const vpos =
          [...vers].sort((a, b) => a.dateAdded - b.dateAdded).findIndex((v) => v.id === track.activeVersionId) + 1;
        return (
          <span className="track-marks">
            {vtotal >= 2 && (
              <span className="track-mark track-mark-v" title="active version / total">
                v{vpos || 1}/{vtotal}
              </span>
            )}
            {notes.length > 0 &&
              (open > 0 ? (
                <span
                  className="track-mark track-mark-notes"
                  title={`${open} open note${open > 1 ? 's' : ''}`}
                >
                  {open}
                </span>
              ) : (
                <span
                  className="track-mark track-mark-notes done"
                  title={`${notes.length} note${notes.length > 1 ? 's' : ''}, all done`}
                >
                  ✓
                </span>
              ))}
          </span>
        );
      })()}
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
