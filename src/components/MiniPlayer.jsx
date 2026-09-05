import { useRef } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import { useGradientDrift } from '../lib/useGradientDrift';
import WaveformSlot from './WaveformSlot';

// Always mounted (App.jsx never unmounts it — it's CSS-hidden via
// `view-hidden` when `active` is false), so it must behave sensibly before
// anything has ever played: `track` is null then, and every hook below is
// already null-safe for that. See the always-mounted WaveformSlot rework.
export default function MiniPlayer({
  track,
  waveformHost,
  isPlaying,
  onTogglePlay,
  onSkip,
  onExit,
  movementIntensity = 0,
  getFrequencyBands,
  active = true
}) {
  const artworkUrl = useObjectUrl(track?.artworkBlob);
  // Freeze the blob the palette hooks see while this view is hidden, so a
  // hidden mini-player never re-samples a cover for track changes it isn't
  // showing (palette extraction has no cache — see dominantColor.js — and
  // three always-mounted views would otherwise each re-extract on every
  // switch). On show it catches up once for the current track; if the track
  // didn't change while hidden, the blob is identical and nothing re-runs.
  const heldBlobRef = useRef(track?.artworkBlob ?? null);
  if (active) heldBlobRef.current = track?.artworkBlob ?? null;
  const paletteBlob = heldBlobRef.current;
  // same cover-derived mesh as the focus view — the gradient's %-based blob
  // positions scale straight down to this small window. undefined for an
  // art-less track, which keeps the plain --surface background.
  const palette = useArtworkPalette(paletteBlob);
  const dominantColor = useDominantColor(paletteBlob);
  const backdropStyle = meshBackdropStyle(palette, dominantColor);
  const miniRef = useRef(null);

  // Same ambient drift as FocusView, same "Background movement" slider —
  // see useGradientDrift.js (MINI_INTENSITY_SCALE is the one knob to turn
  // if this reads as too busy in the small window). `track` here is always
  // the actually-playing track (no browse/play distinction in mini view),
  // so `isPlaying` doesn't need the isViewingPlayingTrack gate FocusView
  // uses. `active` gates the rAF loop entirely while hidden.
  useGradientDrift({
    elRef: miniRef,
    palette,
    backdropStyle,
    intensity: movementIntensity,
    isPlaying,
    getFrequencyBands,
    isMini: true,
    active
  });

  return (
    <div
      ref={miniRef}
      className={`mini-player${backdropStyle ? ' has-backdrop' : ''}${active ? '' : ' view-hidden'}`}
      style={palette ? { backgroundColor: backdropStyle.backgroundColor } : backdropStyle}
    >
      {/* the waveform isn't shown in mini mode, but the slot still claims the
          shared host node while mini is the active view so the <audio>
          element stays attached to the document — a display:none ancestor
          does NOT pause it, only detaching it does */}
      <div style={{ display: 'none' }}>
        <WaveformSlot host={waveformHost} active={active} />
      </div>
      <div
        className="mini-artwork"
        onClick={onExit}
        role="button"
        aria-label="expand player"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="artwork-fallback">♪</span>}
      </div>

      <p className="mini-title">{track ? track.title : 'nothing playing'}</p>

      <div className="mini-transport">
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
