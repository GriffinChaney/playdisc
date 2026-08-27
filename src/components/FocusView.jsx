import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor } from '../lib/useDominantColor';
import { handleArtworkMouseMove, handleArtworkMouseLeave } from '../lib/artworkTilt';
import WaveformSlot from './WaveformSlot';
import ShuffleIcon from './ShuffleIcon';

function formatTime(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function FocusView({
  track,
  waveformHost,
  isCurrentlyPlayingTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onSkip,
  onExitFocus,
  shuffleEnabled,
  onToggleShuffle
}) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);
  const dominantColor = useDominantColor(track?.artworkBlob);
  // Spotify Canvas-style ambient backdrop: the cover's own (saturation-
  // boosted) color fills almost the entire view, only darkening toward the
  // far corners — not a quick fade back to the neutral theme background,
  // which read as barely-there. Falls back to the plain background while
  // the color is still being sampled or the track has no artwork.
  const backdropStyle = dominantColor
    ? {
        background: `radial-gradient(ellipse 150% 110% at 50% 10%, ${dominantColor.vivid} 0%, ${dominantColor.dark} 60%, ${dominantColor.darker} 100%)`
      }
    : undefined;

  return (
    <div className="focus-view" style={backdropStyle}>
      <button className="back-btn" onClick={onExitFocus}>
        ← library
      </button>

      <div
        className="focus-artwork"
        onClick={onExitFocus}
        onMouseMove={handleArtworkMouseMove}
        onMouseLeave={handleArtworkMouseLeave}
        role="button"
        aria-label="collapse fullscreen"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="artwork-fallback large">♪</span>}
      </div>

      <div className="focus-track-info">
        <p className="focus-title">{track?.title}</p>
        <p className="focus-artist">{track?.artist}</p>
      </div>

      <div className="focus-waveform-wrap">
        <div className="waveform-inner">
          <WaveformSlot host={waveformHost} />
          {!isCurrentlyPlayingTrack && (
            <div className="waveform-placeholder-overlay">press play to switch playback to this track</div>
          )}
        </div>
        <div className="time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="transport large">
        <button
          className={`shuffle-btn${shuffleEnabled ? ' active' : ''}`}
          onClick={onToggleShuffle}
          aria-label={shuffleEnabled ? 'disable shuffle' : 'enable shuffle'}
          aria-pressed={shuffleEnabled}
        >
          <ShuffleIcon />
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
      </div>
    </div>
  );
}
