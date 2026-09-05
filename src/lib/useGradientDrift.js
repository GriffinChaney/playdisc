import { useLayoutEffect, useRef } from 'react';

// Ambient audio-reactive motion for the cover-derived mesh backdrop, shared
// by FocusView (fullscreen) and MiniPlayer (2026-09-05: extended to
// MiniPlayer — same hook, same slider, see isMini/MINI_INTENSITY_SCALE
// below). FocusView and MiniPlayer are BOTH always mounted now (App.jsx
// hides the inactive view with CSS rather than unmounting it — see the
// always-mounted WaveformSlot rework), so "only one instance animating at a
// time" is no longer a free consequence of the view switch: it's enforced
// explicitly by the `active` option below. An inactive caller runs no rAF
// loop at all — not a throttled one, none — so a hidden view never burns a
// frame budget and there is never more than one loop alive. Position +
// scale ONLY — never color/opacity/blob count, so the composition stays
// unmistakably the same image, just alive (same colors/blur/feel —
// 2026-09-04: the "blobs never leave their home zone" constraint was
// explicitly relaxed, position amplitude is now large enough that blobs
// travel across the frame; see MAX_POSITION_DRIFT_PCT below). See CLAUDE.md
// / the gradient-drift work for the full design rationale.
//
// NOTE ON DUPLICATION: BLOB_POS and withAlpha below are copied by hand from
// src/lib/meshBackdrop.js, which is deliberately off-limits for this feature
// (color/position extraction must not change). If BLOB_POS ever changes
// there, update BASE_BLOB_POS here to match, or the animated blobs will
// drift from a different starting point than the static fallback.
//
// ---- TUNING CONSTANTS — everything adjustable lives here, in one place ----
// ORBIT_PERIODS_X/Y     seconds per blob per axis; irrational-ish spread so
//                       the combined pattern never visibly repeats
// MAX_POSITION_DRIFT_PCT ceiling on position drift at intensity 100, +/- % of viewport
// MAX_SCALE_SWING      ceiling on low-band scale breathing at intensity 100, +/- fraction of gradient stop
// MAX_HIGH_PULSE       ceiling on high-band pulse (smallest blob only) at intensity 100, +/- fraction, additive
// MID_SPEED_MAX        ceiling on mid-band orbit speed-up at intensity 100, e.g. 0.4 = up to +40% tempo
// AUDIO_REACTION_GAIN  post-smoothing multiplier on the low/mid/high band values before they're
//                       applied to scale/speed — separate from the ceilings above, which cap the
//                       final amount of movement; this controls how easily a band reaches that cap
// ATTACK_MS            EMA time constant while a band is rising (fast, so a kick can snap)
// RELEASE_MS           EMA time constant while a band is falling (slower, reads more musical)
// ANALYSIS_INTERVAL_MS how often getFrequencyBands() is actually called; visuals still update every rAF frame, interpolated between samples
// FREQ_BAND_LOW/MID/HIGH and the per-band envelope normalization live in Waveform.jsx,
//   next to getFrequencyBands() — that's also where "louder than this track's own recent
//   level" is computed, before smoothing happens here
// DEBUG_ISOLATE_AUDIO_REACTION  TEMPORARY tuning toggle, see note below — must be false to ship
// MINI_INTENSITY_SCALE multiplies the WHOLE effect for MiniPlayer only (isMini: true callers);
//                       1.0 = identical to fullscreen at the same slider value. Single knob to
//                       turn if the mini-player reads as too busy once seen live.
// -----------------------------------------------------------------------
const BASE_BLOB_POS = [
  [22, 24],
  [80, 18],
  [68, 78],
  [16, 82],
  [48, 46]
];
function withAlpha(rgb, a) {
  return rgb.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
}

// Prime-ish-second periods per blob per axis. Halved once already (original
// 20-40s -> 10-20s), now roughly halved again to ~6-12s (2026-09-04: still
// read as too slow to perceive even at larger amplitude). Every period is
// scaled by the same factor from the original prime set, so the
// irrational-feeling ratios between them are preserved exactly — the
// combined 8-oscillator pattern still doesn't visibly repeat.
const ORBIT_PERIODS_X = [6.9, 8.7, 9.3, 11.1, 12.3];
const ORBIT_PERIODS_Y = [8.7, 11.1, 6.9, 12.3, 9.3];

// Ceilings — maximums at intensity 1 (slider 100), not targets. Position and
// scale are the ONLY things ever modulated. Raised twice now (2026-09-04):
// first pass ~3x, still reported "too subtle" both for baseline drift and
// for the audio reaction, so this pass is deliberately aggressive rather
// than incremental — meant to overshoot and get dialed back rather than
// undershoot a third time.
//
// MAX_POSITION_DRIFT_PCT in particular is now large enough that blobs are
// NOT clamped to stay inside the viewport or away from each other — at full
// amplitude + adverse phase alignment, a blob whose base position is near an
// edge (e.g. BASE_BLOB_POS's [80, 18] or [16, 82]) can legitimately animate
// past 0%/100% (off-canvas) or close enough to a neighboring blob's base
// position to blend into it. This is intentional per instruction ("tell me
// what value that happened at rather than silently clamping") — nothing
// here clamps x/y, only scaleOffset is clamped (to its own ceiling, not to
// keep blobs apart).
const MAX_POSITION_DRIFT_PCT = 25; // +/- % of viewport (was 9, before that 3)
const MAX_SCALE_SWING = 0.4; // +/- fraction of the blob's radial-gradient stop (was 0.2, before that 0.08)
const MAX_HIGH_PULSE = 0.15; // +/- fraction, smallest blob only, additive (was 0.08, before that 0.03)
const MID_SPEED_MAX = 0.4; // up to +40% orbit tempo at full mid energy (unchanged so far)

// Applied to the SMOOTHED low/mid/high values (below) before they scale
// position/scale/speed — separate lever from the ceilings above. Doubling
// this means a band only needs to reach half its previous "loudness" to
// produce full-ceiling movement; the final amount of movement is still
// capped by MAX_SCALE_SWING/MAX_HIGH_PULSE (scaleOffset is clamped to
// those). No clamp is applied to the gained value itself before use, so
// gain > 1 mostly just means the ceiling gets hit more easily/often, not
// that motion exceeds the ceiling.
const AUDIO_REACTION_GAIN = 2; // was implicitly 1 (no gain stage existed before)

// EMA time constants. Attack is much faster than the original 180ms — that
// was smearing individual kick hits into a constant level. Release stays
// slow so the motion settles rather than twitching back down between hits.
const ATTACK_MS = 50;
const RELEASE_MS = 350;

// FFT analysis is throttled well below 60fps (an FFT per frame isn't free);
// the visual smoothing above still advances every rAF frame regardless, so
// motion interpolates smoothly between analysis samples instead of stepping.
// This is the ONLY smoothing/interpolation applied to band values between
// getFrequencyBands() and the final rendered position — audited 2026-09-04
// in response to "is anything applying additional smoothing after the EMA":
// no CSS transition on background-image (removed earlier, see styles.css),
// no other lerp/interpolation layer anywhere in this file or in
// getFrequencyBands() besides its own envelope normalization (a separate,
// much slower — 1.5s — process; see Waveform.jsx).
const ANALYSIS_INTERVAL_MS = 33; // ~30Hz

// TEMPORARY TUNING SCAFFOLDING — not a feature, remove once the audio
// reaction numbers are settled. When true: baseline orbital drift is
// disabled entirely (blobs stay at their base position, no movement from
// ORBIT_PERIODS at all) so only the audio-reactive scale breathing/pulse is
// visible, making it possible to see whether kicks are actually snapping
// blob scale without the baseline motion masking it. Scale reaction still
// respects the intensity slider. Flip back to false before shipping/
// committing final tuning — this must be false in any committed/shipped
// build. (2026-09-04: this used to also drive periodic console logging of
// band values/blob offsets for a specific diagnostic pass; that logging
// was removed once it had served its purpose — re-add similar temporary
// logging here if another tuning pass needs to read live numbers again.)
const DEBUG_ISOLATE_AUDIO_REACTION = false;

// 2026-09-05: same drift, applied to MiniPlayer too, gated by this single
// multiplier so it can be dialed back independently of fullscreen without
// a second set of tuning constants. 1.0 = no difference from fullscreen at
// the same slider value.
const MINI_INTENSITY_SCALE = 1.0;

function emaStep(current, target, dtMs, tauMs) {
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * alpha;
}

/**
 * Drives the mesh backdrop's blob positions/scale directly via DOM mutation
 * (el.style.backgroundImage), bypassing React's render cycle so a 60fps
 * loop never fights React's own re-renders of the same element. Shared by
 * FocusView and MiniPlayer (isMini).
 *
 * @param {object} opts
 * @param {React.RefObject<HTMLElement>} opts.elRef - the .focus-view or .mini-player node
 * @param {{colors: string[], base: string}|null} opts.palette - from useArtworkPalette; drift is a no-op without one (single-ellipse fallback and no-artwork cases are left entirely alone)
 * @param {object|undefined} opts.backdropStyle - meshBackdropStyle(palette, dominantColor)'s own output, read fresh every frame via ref (never a hook dependency) so its byte-for-byte string is always available for the intensity-0 fallback
 * @param {number} opts.intensity - 0-100, read fresh every frame via ref
 * @param {boolean} opts.isPlaying - read fresh every frame via ref
 * @param {() => {low:number, mid:number, high:number}} [opts.getFrequencyBands] - read fresh every frame via ref
 * @param {boolean} [opts.isMini] - true for the MiniPlayer caller; scales the whole effect by MINI_INTENSITY_SCALE. Static per mount, doesn't need a ref.
 * @param {boolean} [opts.active] - false while the calling view is hidden (App.jsx keeps every view mounted and CSS-hides the inactive ones). An inactive caller runs NO rAF loop; going active starts a fresh one, easing in from the static baseline exactly like a palette change does. A real dependency, not a ref: toggling it must start/stop the loop.
 */
export function useGradientDrift({
  elRef,
  palette,
  backdropStyle,
  intensity,
  isPlaying,
  getFrequencyBands,
  isMini = false,
  active = true
}) {
  // Frequently-changing values are read through refs, updated on every
  // render below, and deliberately kept OUT of the effect's dependency
  // array. currentTime ticks every 200ms and would otherwise re-run this
  // effect constantly, resetting the orbit phase and the EMA smoothing —
  // exactly the kind of stutter this whole feature exists to avoid.
  const backdropStyleRef = useRef(backdropStyle);
  backdropStyleRef.current = backdropStyle;
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const getFrequencyBandsRef = useRef(getFrequencyBands);
  getFrequencyBandsRef.current = getFrequencyBands;

  const rafRef = useRef(0);

  useLayoutEffect(() => {
    // hidden view: no loop at all. The cleanup from the previous run (below)
    // has already cancelled any frame, so this is a hard stop, not a pause.
    if (!active) return;
    const el = elRef.current;
    const colors = palette?.colors;
    if (!el || !colors || !colors.length) return; // nothing to animate

    // Fresh state every time this effect (re)runs — i.e. every new palette
    // (track/cover change). Orbit phase always starts at 0 (sin(0) === 0,
    // exactly the static baseline position) so motion eases in from
    // wherever the static backdrop already was, never popping.
    const state = {
      effectiveTime: 0,
      lastTs: 0,
      lastAnalysisTs: 0,
      smoothed: { low: 0, mid: 0, high: 0 },
      targets: { low: 0, mid: 0, high: 0 }
    };
    const smallestIdx = colors.length - 1;

    function renderStatic() {
      // intensity 0 must be pixel-identical to the un-animated backdrop —
      // reuse meshBackdropStyle's own real output rather than reconstructing
      // it by hand, so there's zero risk of a formatting mismatch (trailing
      // zeros, rounding, etc.) making this only ALMOST identical.
      const bg = backdropStyleRef.current?.backgroundImage;
      if (bg) el.style.backgroundImage = bg;
    }

    function tick(ts) {
      rafRef.current = requestAnimationFrame(tick);

      // Don't do any work — no analysis, no DOM write — while the window is
      // hidden or minimized. rAF is already throttled by the browser when
      // document.hidden, but MiniPlayer is a real, possibly always-on-top
      // OS window (see enterMiniMode in electron/main.js) that can be
      // minimized independently of the rest of the app, so this is an
      // explicit guarantee rather than relying on that throttling alone.
      // Also don't advance the clock while hidden, so becoming visible
      // again resumes cleanly instead of jumping through the elapsed time.
      if (document.hidden) {
        state.lastTs = 0;
        return;
      }

      const intensityFraction =
        Math.max(0, Math.min(1, intensityRef.current / 100)) * (isMini ? MINI_INTENSITY_SCALE : 1);
      if (intensityFraction <= 0) {
        renderStatic();
        // don't advance the clock while off, so turning it back up resumes
        // cleanly rather than having silently drifted in the background
        state.lastTs = 0;
        return;
      }

      if (!state.lastTs) state.lastTs = ts;
      const dt = ts - state.lastTs;
      state.lastTs = ts;

      // Refresh analysis targets at a throttled rate; every-frame work below
      // just smooths toward whatever the latest targets are. No audio (or
      // paused) -> targets decay to 0, so the reaction fades out gracefully
      // instead of snapping off.
      if (ts - state.lastAnalysisTs >= ANALYSIS_INTERVAL_MS) {
        state.lastAnalysisTs = ts;
        const bands = isPlayingRef.current ? getFrequencyBandsRef.current?.() : null;
        state.targets = bands || { low: 0, mid: 0, high: 0 };
      }

      const s = state.smoothed;
      const t = state.targets;
      s.low = emaStep(s.low, t.low, dt, s.low < t.low ? ATTACK_MS : RELEASE_MS);
      s.mid = emaStep(s.mid, t.mid, dt, s.mid < t.mid ? ATTACK_MS : RELEASE_MS);
      s.high = emaStep(s.high, t.high, dt, s.high < t.high ? ATTACK_MS : RELEASE_MS);

      // gain applied post-smoothing, pre-use — see AUDIO_REACTION_GAIN above
      const gLow = s.low * AUDIO_REACTION_GAIN;
      const gMid = s.mid * AUDIO_REACTION_GAIN;
      const gHigh = s.high * AUDIO_REACTION_GAIN;

      // mid band nudges TEMPO, not position — integrate speed over real
      // elapsed time so a changing multiplier never pops the orbit phase
      const speedMultiplier = 1 + intensityFraction * MID_SPEED_MAX * gMid;
      state.effectiveTime += (dt / 1000) * speedMultiplier;

      // TEMPORARY: see DEBUG_ISOLATE_AUDIO_REACTION above — forces position
      // amplitude to 0 so only audio-reactive scale is visible, for tuning.
      const amp = DEBUG_ISOLATE_AUDIO_REACTION ? 0 : intensityFraction * MAX_POSITION_DRIFT_PCT;

      const layers = colors.map((c, i) => {
        const [baseX, baseY] = BASE_BLOB_POS[i % BASE_BLOB_POS.length];
        const periodX = ORBIT_PERIODS_X[i % ORBIT_PERIODS_X.length];
        const periodY = ORBIT_PERIODS_Y[i % ORBIT_PERIODS_Y.length];
        const dx = amp * Math.sin((2 * Math.PI * state.effectiveTime) / periodX);
        const dy = amp * Math.sin((2 * Math.PI * state.effectiveTime) / periodY);
        const x = baseX + dx;
        const y = baseY + dy;

        // low band breathes the LOWER blobs' scale; high band adds a small
        // extra pulse on the smallest (least-dominant) blob only
        let scaleOffset = baseY > 50 ? intensityFraction * MAX_SCALE_SWING * gLow : 0;
        if (i === smallestIdx) scaleOffset += intensityFraction * MAX_HIGH_PULSE * gHigh;
        scaleOffset = Math.max(-MAX_SCALE_SWING, Math.min(MAX_SCALE_SWING, scaleOffset));
        const stopPct = 60 * (1 + scaleOffset);

        return `radial-gradient(circle at ${x.toFixed(2)}% ${y.toFixed(2)}%, ${withAlpha(c, 0.85)} 0%, transparent ${stopPct.toFixed(2)}%)`;
      });

      el.style.backgroundImage = layers.join(', ');
    }

    // seed synchronously (before paint) so there's no flash between React's
    // render and the first animation frame
    renderStatic();
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // `active` is a deliberate dependency: it must start/stop the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elRef, palette, active]);
}
