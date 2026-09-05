import { useRef } from 'react';
import { useObjectUrl } from '../lib/useObjectUrl';
import { useDominantColor, useArtworkPalette } from '../lib/useDominantColor';
import { meshBackdropStyle } from '../lib/meshBackdrop';
import { useGradientDrift } from '../lib/useGradientDrift';
import { useWheelSlider } from '../lib/useWheelSlider';
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
  volume = 1,
  onSetVolume,
  shuffleEnabled = false,
  onToggleShuffle,
  onOpenMenu,
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

  // Volume bar — thin vertical strip along the window's right edge, entirely
  // outside .mini-artwork (see styles.css .mini-volume): the cover is the
  // click target for exiting mini mode, so nothing may sit on top of it or
  // compete for that click. Hidden by default, fades in on hovering the
  // whole mini-player window (not just the bar) via a plain CSS
  // `.mini-player:hover` rule — no JS hover state needed for visibility.
  //
  // Scroll: same non-passive-listener pattern as the settings background-
  // movement slider (see useWheelSlider) — React's onWheel can't
  // preventDefault, which matters here because without it a wheel gesture
  // over the bar could bubble into the OS-level rubber-band/swipe gesture
  // Chromium does on non-scrollable content, an unwanted visual glitch this
  // small fixed window has no business showing.
  const volumeBarElRef = useRef(null);
  const wheelRef = useWheelSlider(volume, onSetVolume, 0.05, { min: 0, max: 1 });
  const setVolumeBarRef = (el) => {
    volumeBarElRef.current = el;
    wheelRef(el);
  };

  // Click/drag: position along the bar maps directly to volume (top = 1,
  // bottom = 0). mousemove/mouseup are attached to `window`, not the bar
  // itself, only for the duration of the drag — the same "temporary global
  // listener pair" shape as the sidebar/now-playing column resize handles in
  // App.jsx, just scoped to this one interaction instead of living for the
  // component's whole lifetime.
  function volumeFromClientY(clientY) {
    const el = volumeBarElRef.current;
    if (!el) return volume;
    const rect = el.getBoundingClientRect();
    const frac = 1 - (clientY - rect.top) / rect.height;
    return Math.min(1, Math.max(0, frac));
  }
  function handleVolumeBarMouseDown(e) {
    e.preventDefault(); // no text selection / native drag-region weirdness
    onSetVolume?.(volumeFromClientY(e.clientY));
    function onMove(ev) {
      onSetVolume?.(volumeFromClientY(ev.clientY));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Right-click the cover: a small shuffle-toggle menu via the app's shared
  // ContextMenu (App.jsx renders the one instance; `onOpenMenu` is its
  // setter, same prop name NowPlaying/FocusView already use). Browsers only
  // ever fire 'contextmenu' for a right-click, never 'click' — .mini-artwork's
  // onClick (exit mini mode) is a left-click-only handler already, so this
  // needs no extra guard to keep the two from firing together.
  function handleArtworkContextMenu(e) {
    e.preventDefault();
    onOpenMenu?.({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: (
            <span className="ctx-label">
              <span className="ctx-check">{shuffleEnabled ? '✓' : ''}</span>
              Shuffle
            </span>
          ),
          onClick: () => onToggleShuffle?.()
        }
      ]
    });
  }

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
        onContextMenu={handleArtworkContextMenu}
        role="button"
        aria-label="expand player"
        style={artworkUrl ? { backgroundImage: `url(${artworkUrl})` } : undefined}
      >
        {!artworkUrl && <span className="artwork-fallback">♪</span>}
      </div>

      {/* Outside .mini-artwork entirely — see the comment above volumeBarElRef
          for why nothing may sit on top of the cover's click target. Theme
          colors (not the cover-pinned-light treatment) since it never sits
          over the artwork or its gradient backdrop. */}
      <div
        ref={setVolumeBarRef}
        className="mini-volume"
        onMouseDown={handleVolumeBarMouseDown}
        role="slider"
        aria-label="volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
      >
        <div className="mini-volume-fill" style={{ height: `${volume * 100}%` }} />
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
