import { useRef } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import { useGradientDrift } from '../lib/useGradientDrift';
import { handleArtworkMouseMove, handleArtworkMouseLeave } from '../lib/artworkTilt';
import WaveformSlot from './WaveformSlot';
import ShuffleIcon from './ShuffleIcon';
import RestartIcon from './RestartIcon';
import RepeatIcon from './RepeatIcon';
import CRTIcon from './CRTIcon';

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
  onToggleShuffle,
  repeatMode,
  onCycleRepeat,
  onOpenArtist,
  onOpenVisualizer,
  movementIntensity = 0,
  getFrequencyBands,
  // Always mounted — App.jsx CSS-hides this view (`view-hidden`) instead of
  // unmounting it, so the shared waveform host node is never detached from
  // the document on a view switch. See the always-mounted WaveformSlot rework.
  active = true
}) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);
  // Freeze the blob the palette hooks see while hidden, so a hidden focus
  // view never re-samples a cover for track changes it isn't showing
  // (palette extraction has no cache — see dominantColor.js). On show it
  // catches up once; if the track didn't change while hidden the blob is
  // identical and nothing re-runs.
  const heldBlobRef = useRef(track?.artworkBlob ?? null);
  if (active) heldBlobRef.current = track?.artworkBlob ?? null;
  const paletteBlob = heldBlobRef.current;
  const dominantColor = useDominantColor(paletteBlob);
  const palette = useArtworkPalette(paletteBlob);
  // Cover-derived mesh backdrop (see meshBackdrop.js). undefined when the
  // track has no artwork — then the view keeps the plain theme background
  // and `has-backdrop` is off so the CSS doesn't force light-on-dark text.
  const backdropStyle = meshBackdropStyle(palette, dominantColor);
  const focusRef = useRef(null);

  // Ambient audio-reactive drift, position/scale only — see useGradientDrift.
  // A no-op without a multi-blob palette (the single-ellipse dominantColor
  // fallback and the no-artwork case are left completely alone); at
  // intensity 0 it renders backdropStyle verbatim, pixel-identical to before
  // this feature existed. `active` gates the rAF loop entirely while hidden.
  useGradientDrift({
    elRef: focusRef,
    palette,
    backdropStyle,
    intensity: movementIntensity,
    isPlaying,
    getFrequencyBands,
    active
  });

  return (
    <div
      ref={focusRef}
      className={`focus-view${backdropStyle ? ' has-backdrop' : ''}${active ? '' : ' view-hidden'}`}
      style={palette ? { backgroundColor: backdropStyle.backgroundColor } : backdropStyle}
    >
      <button className="back-btn" onClick={onExitFocus}>
        ← library
      </button>

      {onOpenVisualizer && (
        <button
          className="focus-visualizer-btn"
          onClick={onOpenVisualizer}
          aria-label="CRT visualizer"
          title="CRT visualizer"
        >
          <CRTIcon />
        </button>
      )}

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
        <p className="focus-artist focus-artist-link" onClick={() => track && onOpenArtist?.(track.artist)}>
          {track?.artist}
        </p>
      </div>

      <div className="focus-waveform-wrap">
        <div className="waveform-inner">
          <WaveformSlot host={waveformHost} active={active} />
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
    </div>
  );
}
