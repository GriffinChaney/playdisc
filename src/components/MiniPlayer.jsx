import { useEffect, useRef, useState } from 'react';
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

  // Whole-window hover state (2026-09-05, reworked). First attempt put
  // onMouseEnter/onMouseLeave directly on the `.mini-player` root div — but
  // that div carries `-webkit-app-region: drag` for window-dragging, and it
  // turns out that CSS property doesn't just break plain `:hover` matching
  // (already known — see the mini-volume-control comment below), it also
  // swallows the DOM mouseenter/mouseleave events themselves on the exact
  // element they're attached to. Only descendants explicitly marked
  // `no-drag` (the cover, and the controls once visible) ever fired them,
  // so hovering the title, the corners, or the plain gradient did nothing.
  //
  // Fix: listen on `document` instead of the drag-region element, gated on
  // `active`. In mini mode the OS window genuinely IS this component,
  // edge-to-edge (see enterMiniMode in main.js), so "mouse entered/left the
  // document" is exactly "mouse entered/left the mini window" — no
  // app-region interference, because we're not attached to the drag element
  // at all. mouseenter/mouseleave (not mouseover/mouseout) is still the
  // right pair here: those don't fire on every child-boundary crossing
  // inside the target the way mouseover/mouseout do, which matters even
  // more on `document` (a single target with the entire page as its only
  // "child" as far as this listener cares) — with mouseover/mouseout,
  // moving the pointer across any inner element's edge would double-fire.
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!active) return;
    function onEnter() {
      setHovering(true);
    }
    function onLeave() {
      setHovering(false);
    }
    document.addEventListener('mouseenter', onEnter);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mouseenter', onEnter);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [active]);

  // Volume control (2026-09-05 rework): its own control, not the app's
  // shared `.volume-control` DOM node reused via CSS rotation. Sharing the
  // node meant rotating the whole pill to get a vertical bar, which also
  // rotated the speaker icon sideways with it — there's no way to rotate
  // just the track without rotating its children. This one reuses the same
  // visual language (`.volume-icon`, `VolumeIcon`, the same `.volume-slider`
  // gradient-fill/thumb tokens) but is its own `<input type="range">`, kept
  // as a sibling of the icon rather than a shared/rotated node, so the icon
  // above it stays upright.
  //
  // The vertical orientation itself went through two approaches:
  // `-webkit-appearance: slider-vertical` first, then `appearance: none` +
  // `writing-mode: vertical-lr` + `direction: rtl` (see .mini-volume-slider
  // in styles.css) — `slider-vertical` looked right but painted its fill
  // with the OS's native accent color (purple on this Mac), ignoring the
  // custom `--vol-pct` gradient background entirely; only fully suppressing
  // native chrome via `appearance: none` (same as every other slider in the
  // app) let our own white/grey gradient actually render, and `writing-mode`
  // gives a real vertical layout box (width = thickness, height = length) —
  // no `rotate()` transform, so there's no rotated-layout-footprint sizing
  // to compensate for either.
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
          style={{ '--vol-pct': `${volume * 100}%` }}
          aria-label="volume"
        />
      </div>

      <p className="mini-title">{track ? track.title : 'nothing playing'}</p>

      {/* Shuffle sits to the LEFT of previous-track (2026-09-05), but is
          absolutely positioned OUT of .mini-transport's flex flow (see
          .mini-shuffle-btn in styles.css) — it's still rendered
          unconditionally (just opacity-gated) so it doesn't pop in/out of
          the layout, but if it were a normal flex child, the row's own
          width would grow/shrink by its width whenever it faded in or out,
          and centering that width under the cover would then also include
          the shuffle button's own width, throwing prev/play/next off-center
          from where they sat before shuffle existed. Taking it out of flow
          means .mini-transport's centered width is computed from exactly
          the same 3 buttons as before. */}
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
