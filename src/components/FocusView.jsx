import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { handleArtworkMouseMove, handleArtworkMouseLeave } from '../lib/artworkTilt';
import WaveformSlot from './WaveformSlot';
import ShuffleIcon from './ShuffleIcon';
import RestartIcon from './RestartIcon';

// where each palette color's blob sits — spread around the frame so the
// colors pool in different regions and blend across the middle
const BLOB_POS = ['22% 24%', '80% 18%', '68% 78%', '16% 82%', '48% 46%'];

function withAlpha(rgb, a) {
  return rgb.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
}

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
  onRestart,
  canRestart,
  onExitFocus,
  shuffleEnabled,
  onToggleShuffle
}) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);
  const dominantColor = useDominantColor(track?.artworkBlob);
  const palette = useArtworkPalette(track?.artworkBlob);
  // Aurora/mesh backdrop: several colors sampled from the cover, each pooled
  // in its own region of the frame and blended across the middle, over a
  // dark base so it never falls to black. Falls back to the older single-
  // color radial while the palette is still sampling, then to the plain
  // theme background if there's no artwork at all.
  let backdropStyle;
  if (palette) {
    backdropStyle = {
      backgroundColor: palette.base,
      backgroundImage: palette.colors
        .map((c, i) => `radial-gradient(circle at ${BLOB_POS[i % BLOB_POS.length]}, ${withAlpha(c, 0.85)} 0%, transparent 60%)`)
        .join(', ')
    };
  } else if (dominantColor) {
    backdropStyle = {
      background: `radial-gradient(ellipse 150% 110% at 50% 10%, ${dominantColor.vivid} 0%, ${dominantColor.dark} 60%, ${dominantColor.darker} 100%)`
    };
  }

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
      </div>
    </div>
  );
}
