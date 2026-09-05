import { useRef, useState } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import { useGradientDrift } from '../lib/useGradientDrift';
import { useWheelSlider } from '../lib/useWheelSlider';
import WaveformSlot from './WaveformSlot';
import VolumeIcon from './VolumeIcon';
import ShuffleIcon from './ShuffleIcon';

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
  volume = 1,
  onSetVolume,
  shuffleEnabled = false,
  onToggleShuffle,
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

  // Whole-window hover state, driven from JS rather than a plain CSS
  // `:hover` rule (2026-09-05). `.mini-player` carries
  // `-webkit-app-region: drag` for window-dragging on its whole card, and in
  // this Electron/macOS setup that interferes with :hover matching — a
  // rotated CSS-only hover attempt only reliably lit up over specific
  // sub-regions instead of the whole card. mouseenter/mouseleave on the root
  // don't have that problem, so `.mini-hovering` below is what the volume
  // pill and shuffle button key their visibility off of.
  const [hovering, setHovering] = useState(false);

  // Volume control (2026-09-05 rework): its own control, not the app's
  // shared `.volume-control` DOM node reused via CSS rotation. Sharing the
  // node meant rotating the whole pill to get a vertical bar, which also
  // rotated the speaker icon sideways with it — there's no way to rotate
  // just the track without rotating its children. This one reuses the same
  // visual language (`.volume-icon`, `VolumeIcon`, the shared color tokens)
  // but is a real native vertical `<input type="range">`
  // (`-webkit-appearance: slider-vertical`), so the icon above it stays
  // upright and only the track itself runs vertically. It's also a genuine
  // native slider now instead of a hand-rolled div + mousedown/mousemove
  // drag loop, so click/drag "just works" via the browser.
  //
  // Positioned bottom-right of the whole mini window (not anywhere over
  // `.mini-artwork`) — the cover is the click target for exiting mini mode,
  // so nothing may sit on top of it or compete for that click.
  //
  // Scroll: same non-passive-listener pattern as the settings background-
  // movement slider (see useWheelSlider) — React's onWheel can't
  // preventDefault, which matters here because without it a wheel gesture
  // over the control could bubble into the OS-level rubber-band/swipe
  // gesture Chromium does on non-scrollable content, an unwanted visual
  // glitch this small fixed window has no business showing.
  const volumeWheelRef = useWheelSlider(volume, onSetVolume, 0.05, { min: 0, max: 1 });

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
      className={`mini-player${backdropStyle ? ' has-backdrop' : ''}${active ? '' : ' view-hidden'}${hovering ? ' mini-hovering' : ''}`}
      style={palette ? { backgroundColor: backdropStyle.backgroundColor } : backdropStyle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
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

      {/* Bottom-right of the window, entirely outside .mini-artwork — see
          the comment above volumeWheelRef for why. Icon stays upright;
          only the track/thumb below it is vertical. */}
      <div className="mini-volume-control">
        <span className="volume-icon mini-volume-icon">
          <VolumeIcon volume={volume} />
        </span>
        <input
          ref={volumeWheelRef}
          type="range"
          className="volume-slider mini-volume-slider"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onSetVolume?.(parseFloat(e.target.value))}
          orient="vertical"
          aria-label="volume"
        />
      </div>

      <p className="mini-title">{track ? track.title : 'nothing playing'}</p>

      <div className="mini-transport">
        <button
          className={`shuffle-btn mini-shuffle-btn${shuffleEnabled ? ' active' : ''}`}
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
