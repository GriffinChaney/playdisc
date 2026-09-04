import { useLayoutEffect, useRef } from 'react';

// Ambient audio-reactive motion for FocusView's cover-derived mesh backdrop.
// Position + scale ONLY — never color/opacity/blob count, so the composition
// stays unmistakably the same image, just alive. See CLAUDE.md / the
// gradient-drift work for the full design rationale.
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
// ATTACK_MS            EMA time constant while a band is rising (fast, so a kick can snap)
// RELEASE_MS           EMA time constant while a band is falling (slower, reads more musical)
// ANALYSIS_INTERVAL_MS how often getFrequencyBands() is actually called; visuals still update every rAF frame, interpolated between samples
// FREQ_BAND_LOW/MID/HIGH and the per-band envelope normalization live in Waveform.jsx,
//   next to getFrequencyBands() — that's also where "louder than this track's own recent
//   level" is computed, before smoothing happens here
// DEBUG_ISOLATE_AUDIO_REACTION  TEMPORARY tuning toggle, see note below — must be false to ship
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

// Prime-ish-second periods per blob per axis, halved from the original
// 20-40s range down to ~10-20s (2026-09-04: original speed was too slow to
// read as motion even at larger amplitudes). Scaling every period by the
// same factor preserves the irrational-feeling ratios between them, so the
// combined 8-oscillator pattern still doesn't visibly repeat within any real
// viewing session.
const ORBIT_PERIODS_X = [11.5, 14.5, 15.5, 18.5, 20.5];
const ORBIT_PERIODS_Y = [14.5, 18.5, 11.5, 20.5, 15.5];

// Ceilings — maximums at intensity 1 (slider 100), not targets. Position and
// scale are the ONLY things ever modulated. Roughly tripled from the first
// pass (2026-09-04: the original ceilings were technically animating but
// too subtle to confidently perceive — "working, just under-tuned"). These
// are a deliberately-large first pass to get into visible range; dial back
// from here once they're confirmed not to break the composition.
const MAX_POSITION_DRIFT_PCT = 9; // +/- % of viewport (was 3)
const MAX_SCALE_SWING = 0.2; // +/- fraction of the blob's radial-gradient stop (was 0.08)
const MAX_HIGH_PULSE = 0.08; // +/- fraction, smallest blob only, additive (was 0.03)
const MID_SPEED_MAX = 0.4; // up to +40% orbit tempo at full mid energy (unchanged)

// EMA time constants. Attack is now MUCH faster than the original 180ms —
// that was smearing individual kick hits into a constant level, which reads
// as "no reaction." Release stays slow so the motion settles rather than
// twitching back down between hits.
const ATTACK_MS = 50; // was 180 — fast enough for a kick to snap
const RELEASE_MS = 350; // was 320 — slightly slower, settles smoothly

// FFT analysis is throttled well below 60fps (an FFT per frame isn't free);
// the visual smoothing above still advances every rAF frame regardless, so
// motion interpolates smoothly between analysis samples instead of stepping.
const ANALYSIS_INTERVAL_MS = 33; // ~30Hz

// TEMPORARY TUNING SCAFFOLDING — not a feature, remove once the audio
// reaction numbers are settled. When true: baseline orbital drift is
// disabled entirely (blobs stay at their base position, no movement from
// ORBIT_PERIODS at all) so only the audio-reactive scale breathing/pulse is
// visible, making it possible to see whether kicks are actually snapping
// blob scale without the baseline motion masking it. Scale reaction still
// respects the intensity slider. Flip back to false before shipping/committing final tuning.
const DEBUG_ISOLATE_AUDIO_REACTION = false;

function emaStep(current, target, dtMs, tauMs) {
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * alpha;
}

/**
 * Drives FocusView's backdrop blob positions/scale directly via DOM
 * mutation (el.style.backgroundImage), bypassing React's render cycle so a
 * 60fps loop never fights React's own re-renders of the same element.
 *
 * @param {object} opts
 * @param {React.RefObject<HTMLElement>} opts.elRef - the .focus-view node
 * @param {{colors: string[], base: string}|null} opts.palette - from useArtworkPalette; drift is a no-op without one (single-ellipse fallback and no-artwork cases are left entirely alone)
 * @param {object|undefined} opts.backdropStyle - meshBackdropStyle(palette, dominantColor)'s own output, read fresh every frame via ref (never a hook dependency) so its byte-for-byte string is always available for the intensity-0 fallback
 * @param {number} opts.intensity - 0-100, read fresh every frame via ref
 * @param {boolean} opts.isPlaying - read fresh every frame via ref
 * @param {() => {low:number, mid:number, high:number}} [opts.getFrequencyBands] - read fresh every frame via ref
 */
export function useGradientDrift({ elRef, palette, backdropStyle, intensity, isPlaying, getFrequencyBands }) {
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

      const intensityFraction = Math.max(0, Math.min(1, intensityRef.current / 100));
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

      // mid band nudges TEMPO, not position — integrate speed over real
      // elapsed time so a changing multiplier never pops the orbit phase
      const speedMultiplier = 1 + intensityFraction * MID_SPEED_MAX * s.mid;
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
        let scaleOffset = baseY > 50 ? intensityFraction * MAX_SCALE_SWING * s.low : 0;
        if (i === smallestIdx) scaleOffset += intensityFraction * MAX_HIGH_PULSE * s.high;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elRef, palette]);
}
