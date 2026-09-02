import { useObjectUrl } from '../lib/useObjectUrl';
import { handleArtworkMouseMove, handleArtworkMouseLeave } from '../lib/artworkTilt';
import WaveformSlot from './WaveformSlot';
import ShuffleIcon from './ShuffleIcon';
import RestartIcon from './RestartIcon';
import RepeatIcon from './RepeatIcon';
import NowPlayingNotes from './NowPlayingNotes';

function formatTime(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function NowPlaying({
  track,
  waveformHost,
  isCurrentlyPlayingTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSkip,
  onRestart,
  canRestart,
  onEnterFocus,
  shuffleEnabled,
  onToggleShuffle,
  repeatMode,
  onCycleRepeat,
  onResizeStart,
  mediaMissing,
  onRelocate,
  onAddNote,
  onToggleNote,
  onDeleteNote,
  onToggleNotePriority,
  onReorderNote
}) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);

  // WaveformSlot must never unmount while something might be playing — the
  // underlying <audio> element pauses the instant it's detached from the
  // document, so "not viewing the playing track" is shown as an overlay
  // on top of it instead of swapping it out for other content.
  return (
    <div className={`now-playing${!track ? ' empty' : ''}`}>
      {onResizeStart && <div className="np-resize-handle" onMouseDown={onResizeStart} />}
      {!track ? (
        <p className="empty-state">select a track to start listening.</p>
      ) : (
        <>
          <div
            className="artwork"
            onClick={onEnterFocus}
            onMouseMove={handleArtworkMouseMove}
            onMouseLeave={handleArtworkMouseLeave}
            role="button"
            aria-label="expand to fullscreen"
            style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
          >
            {!artworkUrl && <span className="artwork-fallback">♪</span>}
          </div>

          <div className="track-info">
            <p className="np-title">{track.title}</p>
            <p className="np-artist">{track.artist}</p>
          </div>
        </>
      )}

      <div className="waveform-wrap" style={!track ? { display: 'none' } : undefined}>
        <div className="waveform-inner">
          <WaveformSlot host={waveformHost} />
          {mediaMissing ? (
            <div className="waveform-placeholder-overlay missing">
              <span>audio file missing</span>
              <button onClick={onRelocate}>relocate…</button>
            </div>
          ) : (
            !isCurrentlyPlayingTrack && (
              <div className="waveform-placeholder-overlay">press play to switch playback to this track</div>
            )
          )}
        </div>
        <div className="time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {track && (
        <div className="transport">
          <button
            className={`shuffle-btn${shuffleEnabled ? ' active' : ''}`}
            onClick={onToggleShuffle}
            aria-label={shuffleEnabled ? 'disable shuffle' : 'enable shuffle'}
            aria-pressed={shuffleEnabled}
          >
            <ShuffleIcon />
          </button>
          <button
            className="restart-btn"
            onClick={onRestart}
            disabled={!canRestart}
            aria-label="restart current song"
            title="restart from the beginning"
          >
            <RestartIcon />
          </button>
          <button onClick={() => onSkip(-1)} aria-label="previous track">
            ⏮
          </button>
          <button className="play-btn" onClick={onTogglePlay} aria-label={isPlaying ? 'pause' : 'play'}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={() => onSkip(1)} aria-label="next track">
            ⏭
          </button>
          <button
            className={`repeat-btn${repeatMode !== 'off' ? ' active' : ''}`}
            onClick={onCycleRepeat}
            aria-label={
              repeatMode === 'one' ? 'repeat one' : repeatMode === 'all' ? 'repeat all' : 'repeat off'
            }
            title={
              repeatMode === 'one' ? 'repeat one' : repeatMode === 'all' ? 'repeat all' : 'repeat off'
            }
          >
            <RepeatIcon one={repeatMode === 'one'} />
          </button>
        </div>
      )}

      {track && (
        <NowPlayingNotes
          trackId={track.id}
          notes={track.notes || []}
          onAddNote={onAddNote}
          onToggleNote={onToggleNote}
          onDeleteNote={onDeleteNote}
          onToggleNotePriority={onToggleNotePriority}
          onReorderNote={onReorderNote}
        />
      )}
    </div>
  );
}
