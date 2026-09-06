import { useEffect, useRef } from 'react';

// Waterfall spectrogram (2026-09-06) — Unknown-Pleasures-style receding
// ridge lines, plain white on black. Entered from FocusView via a corner
// button, exited via Escape (App.jsx's own priority chain) or Cmd+W (this
// component's own capture-phase listener, same shape as
// SettingsModal/SearchOverlay — see that listener below for why).
//
// Pure 2D canvas — the "3D" is a per-line perspective offset (position,
// width, amplitude all shrink toward a horizon as a line ages), not real
// 3D math. Reuses the exact same PCM + FFT pipeline as the gradient drift
// (Waveform.jsx's decoded channel data + wavesurfer's bundled FFT, see
// getSpectrumFrame there) — no AudioContext, no createMediaElementSource;
// that path was ruled unsafe earlier in this project because wavesurfer
// recreates the audio element on every track change and the failure mode
// is silent audio.
//
// PERFORMANCE HISTORY (2026-09-06): the first version (red, 3-pass glow +
// chromatic fringe, plus a full-window CRT overlay — scanlines/vignette/
// flicker) read as laggy. Profiled before touching anything, with an
// isolated canvas benchmark outside this app (same draw code, synthetic
// data, both at 1x and a simulated 2x devicePixelRatio backing store):
// raw drawing time came back near-negligible — under 1ms/frame even in the
// worst case tested (every one of 84 lines given the full 3-pass glow) —
// which means the per-line math and even shadowBlur itself were NOT the
// smoking gun in that isolated test. That test could not fully reproduce
// Electron's real compositing pipeline, though, and it could not measure
// the OTHER thing running the whole time regardless: the full-window CRT
// overlay (three extra always-composited layers, one continuously
// animating for the flicker) sitting on top of a canvas repainting every
// frame. Rather than keep guessing at a cost this environment couldn't
// fully reproduce, the fix is the one already independently decided below
// (drop the red/glow/CRT treatment entirely) — it removes every one of the
// remaining suspects at once: per-frame shadowBlur/globalCompositeOperation
// state churn (both well-documented as expensive on real GPU/driver
// combinations even when a synthetic benchmark undersells them), the
// 3-pass-plus-fringe stroke count per line, and the whole extra composited
// overlay stack. What's left is one stroke() call per line, at most one
// shadowBlur among them (ENABLE_GLOW below), and nothing else drawn.
//
// ---------------------------------------------------------------------
// TUNING — every knob for the perspective and the line look lives here.
// Griffin will be retuning these repeatedly; nothing below this block
// should need touching for a look/feel change.
// ---------------------------------------------------------------------

// --- Data / performance ---
// Points sampled per HALF line (the spectrum is mirrored left/right around
// the center — see pushFrame below — so each line has 2x this many points
// on screen). More = smoother ridges, more draw cost.
const SPECTRUM_HALF_POINTS = 110;
// How many lines stay on screen at once (the rolling buffer depth).
const MAX_LINES = 84;
// How often a NEW line is analyzed/pushed, in ms — decoupled from the
// render loop (which still runs every rAF for smooth motion). Raising
// this reduces FFT+bucketing cost with very little visible effect on
// smoothness, since positions are interpolated between pushes anyway
// (see scrollProgress in render() below) rather than only updating when a
// new line arrives. 40ms = a new line every ~2.4 frames at 60fps.
const ANALYSIS_INTERVAL_MS = 40;

// --- Perspective geometry (all fractions of canvas width/height) ---
const FRONT_Y_FRACTION = 0.95; // newest line's baseline, near the bottom
// Pushed up from 0.34 (2026-09-06) — "the perspective is too shallow, the
// horizon needs to be higher" — more vertical room between front and
// horizon is what actually buys more depth; DEPTH_EASE_POWER below shapes
// how that room gets used, not how much of it there is.
const HORIZON_Y_FRACTION = 0.16;
// >1 bunches lines closer together as they approach the horizon (real
// perspective falloff); 1 would space them evenly, which reads as flat.
// Raised from 2.2 — the old value spread lines too evenly; this bunches
// the back half much harder, so distant lines compress into the horizon
// noticeably instead of just gradually thinning out.
const DEPTH_EASE_POWER = 3.4;
// How narrow the farthest line gets (1 = full width). Lowered from 0.2 —
// distant lines should read as small and converged, not just "a bit
// narrower."
const MIN_WIDTH_SCALE = 0.08;
// How flat the farthest line's peaks get. Lowered from 0.12 to match.
const MIN_AMP_SCALE = 0.05;
const MAX_AMPLITUDE_FRACTION = 0.22; // front line's peak height, as a fraction of canvas height
const MIN_LINE_OPACITY = 0.12; // farthest line's opacity floor (0 would vanish completely)
// How far each line's flat baseline extends past the canvas's own left/right
// edges (before the perspective width shrink is applied), so the ends of
// every line run off-frame instead of showing a visible stop point. Canvas
// draw calls outside 0..width are simply clipped by the canvas's own
// bounds, so this needs no explicit clipping code of its own.
const EDGE_OVERFLOW_PX = 140;

// --- Amplitude scaling (raw FFT magnitude -> 0..1 for drawing) ---
// Adaptive peak so a quiet track doesn't read as a flat line and a loud
// one doesn't clip at the top — see peakRef below. Decay < 1 lets the
// tracked peak slowly relax after a loud section ends; LOG_GAIN compresses
// dynamic range (log, not linear) so quiet frequency content stays visible
// alongside the loudest bins instead of vanishing near zero.
const PEAK_DECAY = 0.985;
const LOG_GAIN = 18;

// --- Line look (2026-09-06: back to plain Joy Division white, no red, no
// CRT treatment — see the performance history note above for why the two
// changes landed together). One stroke() call per line; ENABLE_GLOW adds a
// single shadowBlur pass on top of that same call (not an extra stroke) for
// the nearest GLOW_LINE_COUNT lines only. Flip ENABLE_GLOW to false first
// if frame rate is still a problem after this pass — it's the one knob
// that removes shadowBlur from the picture entirely rather than just
// reducing it. ---
const LINE_COLOR = '#f4f4f2';
const LINE_WIDTH = 1.4;
const ENABLE_GLOW = true;
const GLOW_LINE_COUNT = 30; // nearest N lines only — distant ones are thin/faint anyway
const GLOW_BLUR_PX = 5;

// ---------------------------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function CRTVisualizer({ getSpectrumFrame, onExit }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const framesRef = useRef([]); // oldest first, up to MAX_LINES Float32Arrays
  const lastAnalysisTimeRef = useRef(0);
  const peakRef = useRef(1e-6);
  // Mirrored into a ref (same pattern useGradientDrift.js already uses for
  // its own getFrequencyBands prop) so the render-loop effect below can
  // depend on nothing and run exactly once for this component's whole
  // mounted lifetime. App.jsx passes an inline arrow function for this
  // prop, which gets a new identity on every one of its own re-renders
  // (e.g. every 200ms currentTime tick during playback) — if the effect
  // depended on the prop directly, that would tear down and rebuild the
  // canvas/resize/rAF setup that often, which is exactly the kind of
  // "re-renders through playback" bug the currentTime-throttle comment
  // elsewhere in this app warns about.
  const getSpectrumFrameRef = useRef(getSpectrumFrame);
  getSpectrumFrameRef.current = getSpectrumFrame;
  // reused per-frame scratch buffers, sized for the full mirrored line
  // (2x the half-spectrum) — avoids allocating a fresh x/y array for every
  // one of up to MAX_LINES lines, every rAF tick
  const POINTS = SPECTRUM_HALF_POINTS * 2;
  const xScratchRef = useRef(new Float32Array(POINTS));
  const yScratchRef = useRef(new Float32Array(POINTS));

  // Cmd+W, same shape as SettingsModal's/SearchOverlay's own capture-phase
  // listener and for the same reason: this has to run and stopPropagation
  // BEFORE App.jsx's bubble-phase dispatcher ever sees it, so the two never
  // need to inspect each other's state. Escape is deliberately NOT handled
  // here — that lives in App.jsx's own Escape priority chain instead (it
  // has to run before the generic "leave fullscreen/mini" check there,
  // since view==='visualizer' would otherwise match that too and land on
  // sidebar instead of back on fullscreen).
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        onExit();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function pushFrame() {
      const raw = getSpectrumFrameRef.current(SPECTRUM_HALF_POINTS);
      if (!raw) return;
      let frameMax = 1e-6;
      for (let i = 0; i < raw.length; i++) if (raw[i] > frameMax) frameMax = raw[i];
      peakRef.current = Math.max(frameMax, peakRef.current * PEAK_DECAY);
      const peak = peakRef.current;
      // Mirrored left/right around the center (2026-09-06 — "frequencies
      // should be centered, not left-anchored"): raw[0] is the lowest
      // frequency bucket, raw[last] the highest. Placed so the LOWEST
      // frequency sits at the two center points and frequency increases
      // toward BOTH edges — i.e. read raw back-to-front for the left half,
      // forward for the right half. Most musical energy lives in the low
      // end, so this naturally puts the visible activity in the middle
      // with both edges trailing off toward quieter high-frequency
      // content, matching the reference image's shape.
      const half = raw.length;
      const frame = new Float32Array(half * 2);
      for (let i = 0; i < half; i++) {
        const v = Math.min(1, raw[i] / peak);
        const compressed = Math.log1p(v * LOG_GAIN) / Math.log1p(LOG_GAIN);
        frame[half - 1 - i] = compressed; // left half, low freq at center (index half-1)
        frame[half + i] = compressed; // right half, low freq at center (index half)
      }
      const frames = framesRef.current;
      frames.push(frame);
      if (frames.length > MAX_LINES) frames.shift();
    }

    function drawLine(frame, depth) {
      const t = Math.min(1, Math.max(0, depth / MAX_LINES)); // 0 = front, 1 = back
      const baseY = lerp(
        height * FRONT_Y_FRACTION,
        height * HORIZON_Y_FRACTION,
        Math.pow(t, 1 / DEPTH_EASE_POWER)
      );
      const widthScale = lerp(1, MIN_WIDTH_SCALE, t);
      const ampScale = lerp(1, MIN_AMP_SCALE, t);
      const opacity = Math.max(MIN_LINE_OPACITY, 1 - t);
      // drawn wider than the canvas itself (before the perspective shrink)
      // so the ends run off both edges — see EDGE_OVERFLOW_PX above
      const spanPx = (width + EDGE_OVERFLOW_PX * 2) * widthScale;
      const left = (width - spanPx) / 2;
      const maxAmpPx = height * MAX_AMPLITUDE_FRACTION * ampScale;

      const count = frame.length;
      const xs = xScratchRef.current;
      const ys = yScratchRef.current;
      for (let i = 0; i < count; i++) {
        xs[i] = left + (i / (count - 1)) * spanPx;
        ys[i] = baseY - frame[i] * maxAmpPx;
      }

      // Fill from the ridge down to the bottom of the canvas in solid
      // black, THEN stroke on top — drawing strictly back-to-front, each
      // subsequent (nearer) line's fill repaints over whatever a farther
      // line drew beneath its own ridge, which is the entire occlusion
      // trick (same technique as the classic Joy Division / ridgeline
      // plot rendering: no depth buffer, just correct paint order).
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(xs[0], height);
      for (let i = 0; i < count; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.lineTo(xs[count - 1], height);
      ctx.closePath();
      ctx.fill();

      // One stroke() call per line, period — ENABLE_GLOW only ever adds a
      // shadowBlur to THIS same call for the nearest GLOW_LINE_COUNT lines,
      // never a second stroke. See the performance history note up top.
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = LINE_WIDTH;
      if (ENABLE_GLOW && depth < GLOW_LINE_COUNT) {
        ctx.shadowColor = LINE_COLOR;
        ctx.shadowBlur = GLOW_BLUR_PX;
      }
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < count; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
      ctx.restore();
    }

    function render(now) {
      rafRef.current = requestAnimationFrame(render);
      if (width <= 0 || height <= 0) return;

      if (now - lastAnalysisTimeRef.current >= ANALYSIS_INTERVAL_MS) {
        pushFrame();
        lastAnalysisTimeRef.current = now;
      }
      // fractional progress toward the NEXT push — every line's depth
      // shifts continuously by this amount each frame, so motion stays
      // smooth at 60fps even though new data only arrives every
      // ANALYSIS_INTERVAL_MS (see the module comment above).
      const scrollProgress = Math.min(1, (now - lastAnalysisTimeRef.current) / ANALYSIS_INTERVAL_MS);

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      const frames = framesRef.current;
      const n = frames.length;
      // back to front: oldest (largest depth) first
      for (let i = 0; i < n; i++) {
        const depth = n - 1 - i + scrollProgress;
        drawLine(frames[i], depth);
      }
    }

    rafRef.current = requestAnimationFrame(render);

    // Page Visibility, not just the view-swap unmount below — covers the
    // window being minimized/occluded while still technically mounted
    // (e.g. Cmd+Tab away without leaving the visualizer), so the loop
    // doesn't keep spending CPU on a tab nobody can see.
    function handleVisibility() {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(render);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="crt-visualizer">
      <canvas ref={canvasRef} className="crt-canvas" />
    </div>
  );
}
