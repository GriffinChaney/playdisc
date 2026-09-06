import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';
import FFT from 'wavesurfer.js/dist/fft.js';
import { makeAmplitudeScale } from '../lib/dominantColor';

const EQ_BAR_COUNT = 24;
// throttled well below 60fps so bars snap between heights instead of
// smoothly interpolating — reads as chunky pixel-art rather than a wobble
const EQ_UPDATE_INTERVAL_MS = 90;

// getFrequencyBands(): a window of already-decoded PCM around the playhead,
// run through wavesurfer's own bundled FFT (imported nowhere else in the
// app before this). No AudioContext, no createMediaElementSource, no touch
// of the audio output path at all — see the gradient-drift investigation.
// Power of 2, required by FFT.calculateSpectrum. 2048 samples is cheap
// (sub-millisecond) and gives ~21Hz bins at 44.1kHz, plenty for 3 broad bands.
const FREQ_FFT_SIZE = 2048;
// Rough band boundaries (Hz) — frequency bands, not instrument separation.
// Bass guitar and kick drum overlap here; that's an inherent limit of this
// technique, not a bug. Tightened 2026-09-04 (LOW was 20-250, MID 250-4000,
// HIGH 4000-16000) — LOW in particular was wide enough to capture most of a
// track's low-mid energy and barely vary; narrowed to the kick/bass
// fundamental range so it actually tracks individual hits instead of
// staying near-constant.
const FREQ_BAND_LOW = [20, 160];
const FREQ_BAND_MID = [300, 2000];
const FREQ_BAND_HIGH = [6000, 16000];
// getSpectrumFrame()'s log-frequency range — see that method below.
const SPECTRUM_MIN_HZ = 40;
const SPECTRUM_MAX_HZ = 16000;
// Per-band envelope normalization (2026-09-04, replaced a fixed empirical
// gain constant): raw FFT magnitude varies enormously between tracks and
// between sections of one track, so mapping it directly to motion meant a
// quiet/compressed track barely moved and a loud one slammed. Each band is
// instead compared against a running average of ITS OWN recent level — what
// drives the motion is "louder than this track's normal right now," not an
// absolute magnitude.
//
// ENVELOPE_TAU_MS: how many ms of recent history the "normal" average
// covers. Lowered from 5000ms to 1500ms (2026-09-04) — 5s was smoothing
// across whole musical phrases (bridge-to-chorus level), not tracking the
// current moment, which is too slow a reference for per-kick reaction.
//
// Mapping raw-vs-envelope to a 0..1 reactive value: originally a hard
// linear clamp — (ratio-1)/RANGE, clamped to [0,1] — which meant any hit
// louder than RANGE-above-normal pegged at a flat 1.0. On percussive
// material where MANY hits clear that bar, most frames would sit pegged at
// the ceiling rather than varying, which reads as "constant," i.e. exactly
// the flatness being chased. Replaced with an exponential saturation curve
// (1 - e^-(excess/RANGE)) — asymptotic rather than hard-clamped, so
// even hits well above "normal" still produce visibly different output
// instead of all landing on the same plateau. ENVELOPE_REACTIVE_RANGE is
// now the excess-ratio (raw/envelope - 1) that produces ~63% of full
// strength; smaller = more sensitive.
const ENVELOPE_TAU_MS = 1500;
const ENVELOPE_REACTIVE_RANGE = 0.6;

// Default coloring: louder bars run hot (red/orange), quieter run cool
// (teal/green) — a loudness heatmap. When the playing track has cover art,
// App feeds a `palette` and this is swapped for a scale built from those
// colors (see makeAmplitudeScale).
function amplitudeColor(amplitude) {
  const hue = 150 - amplitude * 150;
  const lightness = 48 + amplitude * 10;
  return `hsl(${hue}, 85%, ${lightness}%)`;
}

// Custom bar renderer (wavesurfer's renderFunction hook) so each bar's
// color reflects its own loudness instead of just its screen position.
// `colorFn` maps a 0..1 amplitude to a CSS color.
function renderHeatmapBars(channelData, ctx, colorFn = amplitudeColor) {
  const { width, height } = ctx.canvas;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const barWidth = 2 * pixelRatio;
  const barGap = 2 * pixelRatio;
  const spacing = barWidth + barGap;
  const halfHeight = height / 2;

  const channel = channelData[0] || [];
  const length = channel.length;
  if (!length || width <= 0) return;

  // renderFunction bypasses wavesurfer's built-in normalize step, so scale
  // bar heights against this track's own peak ourselves.
  let max = 0;
  for (let i = 0; i < length; i++) {
    const v = Math.abs(channel[i] || 0);
    if (v > max) max = v;
  }
  if (!max) max = 1;

  const barIndexScale = width / spacing / length;
  let prevX = 0;
  let peak = 0;

  for (let i = 0; i <= length; i++) {
    const x = Math.round(i * barIndexScale);
    if (x > prevX) {
      const amplitude = Math.min(1, peak / max);
      const barHeight = Math.max(2, Math.round(amplitude * halfHeight));
      const y = halfHeight - barHeight;

      ctx.fillStyle = colorFn(amplitude);
      ctx.beginPath();
      if ('roundRect' in ctx) {
        ctx.roundRect(prevX * spacing, y, barWidth, barHeight * 2, 1);
      } else {
        ctx.rect(prevX * spacing, y, barWidth, barHeight * 2);
      }
      ctx.fill();

      prevX = x;
      peak = 0;
    }
    const v = Math.abs(channel[i] || 0);
    if (v > peak) peak = v;
  }
}

// Imperative handle exposes play/pause/toggle/seek so the parent (NowPlaying /
// FocusView) can drive playback from its own transport buttons, while this
// component owns the actual wavesurfer instance and the click/drag-to-seek
// behavior.
function progressColorFor(theme, onDarkBackdrop) {
  // the played-region wash has to contrast with whatever's behind the
  // waveform. On a dark backdrop (fullscreen / mini over cover art) the
  // light wash reads in both themes — same value dark mode already uses.
  // In the library view, light theme sits on a near-white surface, so it
  // needs the darker wash instead.
  if (onDarkBackdrop || theme !== 'light') return 'rgba(255, 255, 255, 0.3)';
  return 'rgba(0, 0, 0, 0.5)';
}

const Waveform = forwardRef(function Waveform(
  {
    audioUrl,
    theme,
    palette,
    onDarkBackdrop = false,
    height = 60,
    onReady,
    onFinish,
    onTimeUpdate,
    onPlayStateChange
  },
  ref
) {
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const decodedChannelRef = useRef(null);
  const sampleRateRef = useRef(44100);
  const trackPeakRef = useRef(1);
  const eqBarRefs = useRef([]);
  const eqRafRef = useRef(null);
  // amplitude -> color; swapped to a cover-palette scale when one is available
  const colorFnRef = useRef(amplitudeColor);
  // reused across calls/tracks so getFrequencyBands() doesn't reallocate the
  // FFT's internal sin/cos tables or the sample buffer on every call; only
  // rebuilt if the sample rate actually changes between tracks
  const fftRef = useRef(null);
  const fftBufferRef = useRef(new Float32Array(FREQ_FFT_SIZE));
  // per-band running "normal level" envelope (raw magnitude units, pre-gain,
  // pre-normalization) + last-call timestamp for the EMA dt; reset per track
  // in the 'ready' handler below so a new song starts from a fresh baseline
  // rather than carrying over the previous track's loudness
  const bandEnvelopeRef = useRef({ low: 0, mid: 0, high: 0 });
  const bandEnvelopeInitRef = useRef(false);
  const bandEnvelopeLastTsRef = useRef(0);
  // reused output buffer for getSpectrumFrame() (CRTVisualizer.jsx) —
  // reallocated only if the caller ever asks for a different point count
  // than last time, which in practice never happens at runtime (it's a
  // tuning constant on the caller's side, not something that varies frame
  // to frame)
  const spectrumFrameRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    // wavesurfer always re-tints the "played" region with a flat color on
    // top of the base heatmap canvas. Fully transparent (tried previously)
    // stopped it from looking like it "changes color" while scrubbing, but
    // also made played bars invisible against the surface in both themes —
    // a theme-aware translucent wash keeps it legible without being jarring.
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3d3a5c',
      progressColor: progressColorFor(theme, onDarkBackdrop),
      cursorColor: '#f97316',
      cursorWidth: 2,
      height,
      renderFunction: (chan, ctx) => renderHeatmapBars(chan, ctx, colorFnRef.current),
      interact: true, // <-- this is what makes click/drag-to-seek work
      dragToSeek: true // scrub by clicking and dragging across the waveform
    });

    wsRef.current = ws;
    ws.load(audioUrl);

    ws.on('ready', () => {
      onReady?.(ws.getDuration());
      // Grab the decoded samples once so the equalizer can sample live
      // amplitude per sub-band from them on every tick.
      const decoded = ws.getDecodedData();
      if (decoded) {
        const channel = decoded.getChannelData(0);
        decodedChannelRef.current = channel;
        sampleRateRef.current = decoded.sampleRate;
        let max = 0;
        for (let i = 0; i < channel.length; i++) {
          const v = Math.abs(channel[i]);
          if (v > max) max = v;
        }
        trackPeakRef.current = max || 1;
      }
      // fresh envelope baseline for the new track — see bandEnvelopeRef above
      bandEnvelopeRef.current = { low: 0, mid: 0, high: 0 };
      bandEnvelopeInitRef.current = false;
      bandEnvelopeLastTsRef.current = 0;
    });
    ws.on('finish', () => onFinish?.());
    ws.on('audioprocess', (currentTime) => onTimeUpdate?.(currentTime));
    ws.on('interaction', () => onTimeUpdate?.(ws.getCurrentTime()));
    ws.on('play', () => {
      onPlayStateChange?.(true);
      startEqualizerLoop();
    });
    ws.on('pause', () => {
      onPlayStateChange?.(false);
      stopEqualizerLoop();
    });
    // A decode/network failure doesn't reliably fire 'pause' on every
    // platform, which would leave isPlaying stuck true — and downstream,
    // main.js's global media keys stuck registered (see App.jsx's
    // setPlaybackActive effect, which is keyed on isPlaying). Treat any
    // wavesurfer error as an explicit stop.
    ws.on('error', (err) => {
      console.error('[waveform] playback error:', err);
      onPlayStateChange?.(false);
      stopEqualizerLoop();
    });

    // Drives the little pixel-bar equalizer strip independently of
    // wavesurfer's own event cadence, sampling a window of decoded audio
    // around the current playhead and splitting it into per-bar sub-bands.
    function startEqualizerLoop() {
      let lastUpdate = 0;
      function tick(timestamp) {
        eqRafRef.current = requestAnimationFrame(tick);
        if (timestamp - lastUpdate < EQ_UPDATE_INTERVAL_MS) return;
        lastUpdate = timestamp;

        const channel = decodedChannelRef.current;
        const currentWs = wsRef.current;
        if (!channel || !currentWs) return;

        const centerSample = Math.floor(currentWs.getCurrentTime() * sampleRateRef.current);
        const windowSize = 5000;
        const segSize = Math.floor(windowSize / EQ_BAR_COUNT);
        const start = Math.max(0, centerSample - windowSize / 2);

        for (let b = 0; b < EQ_BAR_COUNT; b++) {
          const segStart = Math.min(channel.length, start + b * segSize);
          const segEnd = Math.min(channel.length, segStart + segSize);
          let peak = 0;
          for (let i = segStart; i < segEnd; i++) {
            const v = Math.abs(channel[i]);
            if (v > peak) peak = v;
          }
          const amplitude = Math.min(1, Math.pow(peak / trackPeakRef.current, 0.6));
          const el = eqBarRefs.current[b];
          if (el) {
            el.style.height = `${8 + amplitude * 92}%`;
            el.style.background = colorFnRef.current(amplitude);
          }
        }
      }
      eqRafRef.current = requestAnimationFrame(tick);
    }

    function stopEqualizerLoop() {
      if (eqRafRef.current) cancelAnimationFrame(eqRafRef.current);
      eqRafRef.current = null;
      eqBarRefs.current.forEach((el) => {
        if (el) {
          el.style.height = '8%';
          el.style.background = '';
        }
      });
    }

    return () => {
      stopEqualizerLoop();
      ws.destroy();
      wsRef.current = null;
      decodedChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Theme toggles don't recreate the WaveSurfer instance (that's keyed only
  // off audioUrl, to avoid restarting playback), so the progress color was
  // previously stuck at whatever it was when the instance was created —
  // looking "bugged" until the next track load happened to pick up the new
  // theme. Re-tint the existing instance directly instead.
  useEffect(() => {
    wsRef.current?.setOptions({ progressColor: progressColorFor(theme, onDarkBackdrop) });
  }, [theme, onDarkBackdrop]);

  // Recolor the visualizer from the playing track's cover. The EQ strip picks
  // it up on its next frame automatically (reads colorFnRef live); the
  // waveform canvas is already painted, so re-set renderFunction to force
  // wavesurfer to repaint it. No palette (no artwork) -> default heatmap.
  useEffect(() => {
    const scale = makeAmplitudeScale(palette?.colors);
    colorFnRef.current = scale || amplitudeColor;
    const ws = wsRef.current;
    if (!ws) return;
    ws.setOptions({
      renderFunction: (chan, ctx) => renderHeatmapBars(chan, ctx, colorFnRef.current),
      cursorColor: scale ? scale(1) : '#f97316'
    });
  }, [palette]);

  useImperativeHandle(ref, () => ({
    play: () => wsRef.current?.play(),
    pause: () => wsRef.current?.pause(),
    toggle: () => wsRef.current?.playPause(),
    isPlaying: () => wsRef.current?.isPlaying() ?? false,
    seekTo: (fraction) => wsRef.current?.seekTo(fraction), // 0..1
    skip: (seconds) => wsRef.current?.skip(seconds), // relative nudge, +/- seconds
    setVolume: (v) => wsRef.current?.setVolume(v), // 0..1
    getVolume: () => wsRef.current?.getVolume() ?? 1,
    // Hold-space-for-2x (2026-09-06). wavesurfer's setPlaybackRate(rate,
    // preservePitch) sets the underlying <audio> element's `playbackRate`
    // and, when preservePitch is passed, its `preservesPitch` directly
    // (see node_modules/wavesurfer.js/dist/player.js) — the unprefixed,
    // standard property. Confirmed live in this Electron/Chromium version
    // ('preservesPitch' in HTMLMediaElement.prototype is true;
    // 'webkitPreservesPitch' is not present) — no vendor-prefixed fallback
    // needed here, unlike some older-Chromium-era advice you'll find
    // online. preservePitch=false is the "tape/record speeding up" effect
    // (pitch rises with speed); true is the default browser behavior
    // (pitch held constant, only tempo changes) used to reset back to 1x.
    setPlaybackRate: (rate, preservePitch) => wsRef.current?.setPlaybackRate(rate, preservePitch),
    getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
    getDuration: () => wsRef.current?.getDuration() ?? 0,
    // single 0..1 loudness reading at the current playhead, for small
    // reactive UI elsewhere (e.g. the background-play-bar's mini meter)
    getAmplitude: () => {
      const channel = decodedChannelRef.current;
      const ws = wsRef.current;
      if (!channel || !ws) return 0;
      const centerSample = Math.floor(ws.getCurrentTime() * sampleRateRef.current);
      const windowSize = 4000;
      const start = Math.max(0, centerSample - windowSize / 2);
      const end = Math.min(channel.length, centerSample + windowSize / 2);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(channel[i]);
        if (v > peak) peak = v;
      }
      return Math.min(1, Math.pow(peak / trackPeakRef.current, 0.6));
    },
    // { low, mid, high }, each ~0..1 — an FFT over a window of already-decoded
    // PCM around the playhead, split into three broad bands. For decorative
    // audio-reactive UI (the fullscreen gradient drift); not audio-precise,
    // frequency bands rather than instrument separation.
    getFrequencyBands: () => {
      const channel = decodedChannelRef.current;
      const ws = wsRef.current;
      const zero = { low: 0, mid: 0, high: 0 };
      if (!channel || !ws) return zero;

      const sampleRate = sampleRateRef.current;
      if (!fftRef.current || fftRef.current.sampleRate !== sampleRate) {
        fftRef.current = new FFT(FREQ_FFT_SIZE, sampleRate, 'hann');
      }
      const fft = fftRef.current;
      const buffer = fftBufferRef.current;

      const centerSample = Math.floor(ws.getCurrentTime() * sampleRate);
      const start = Math.max(0, Math.min(channel.length - FREQ_FFT_SIZE, centerSample - FREQ_FFT_SIZE / 2));
      for (let i = 0; i < FREQ_FFT_SIZE; i++) {
        const s = start + i;
        buffer[i] = s < channel.length ? channel[s] : 0;
      }

      let spectrum;
      try {
        spectrum = fft.calculateSpectrum(buffer);
      } catch {
        return zero; // e.g. a track shorter than one FFT window
      }

      const binWidth = sampleRate / FREQ_FFT_SIZE;
      const bandLevel = ([loHz, hiHz]) => {
        const i0 = Math.max(0, Math.floor(loHz / binWidth));
        const i1 = Math.min(spectrum.length - 1, Math.ceil(hiHz / binWidth));
        let sum = 0;
        let n = 0;
        for (let i = i0; i <= i1; i++) {
          sum += spectrum[i];
          n++;
        }
        return n ? sum / n : 0;
      };
      const raw = {
        low: bandLevel(FREQ_BAND_LOW),
        mid: bandLevel(FREQ_BAND_MID),
        high: bandLevel([FREQ_BAND_HIGH[0], Math.min(FREQ_BAND_HIGH[1], sampleRate / 2)])
      };

      // Update each band's running "normal level" envelope, then express
      // this instant's level as how far ABOVE that normal it is — see
      // ENVELOPE_TAU_MS / ENVELOPE_REACTIVE_RANGE above. First call after a
      // track loads snaps the envelope straight to the current raw level
      // instead of climbing from 0, so the very first frames of a song
      // don't read as "infinitely louder than normal."
      const env = bandEnvelopeRef.current;
      const now = performance.now();
      if (!bandEnvelopeInitRef.current) {
        env.low = raw.low;
        env.mid = raw.mid;
        env.high = raw.high;
        bandEnvelopeInitRef.current = true;
      } else {
        const dt = now - bandEnvelopeLastTsRef.current;
        const alpha = 1 - Math.exp(-dt / ENVELOPE_TAU_MS);
        env.low += (raw.low - env.low) * alpha;
        env.mid += (raw.mid - env.mid) * alpha;
        env.high += (raw.high - env.high) * alpha;
      }
      bandEnvelopeLastTsRef.current = now;

      const EPSILON = 1e-6;
      // excess = how far above "normal" this instant is, as a ratio (0 =
      // exactly normal or quieter, 1 = twice normal, etc) — unclamped going
      // in, so a big transient doesn't get thrown away before the curve
      // below has a chance to differentiate it from a merely-loud one.
      const reactive = (band) => {
        const excess = Math.max(0, raw[band] / Math.max(env[band], EPSILON) - 1);
        return 1 - Math.exp(-excess / ENVELOPE_REACTIVE_RANGE);
      };

      return {
        low: reactive('low'),
        mid: reactive('mid'),
        high: reactive('high')
      };
    },
    // Full-spectrum version of getFrequencyBands, for CRTVisualizer.jsx's
    // waterfall — each line there is a whole frequency frame, not 3 collapsed
    // bands, so this returns `pointCount` magnitude values log-spaced across
    // MIN_SPECTRUM_HZ..MAX_SPECTRUM_HZ (audio content spreads out
    // logarithmically — a linear bin mapping would cram almost all visible
    // energy into the first few output points). Same FFT/window/PCM source
    // as getFrequencyBands (no separate AudioContext, no
    // createMediaElementSource — see that method's own comment for why).
    // Raw magnitude, not envelope-normalized against a running "normal
    // level" the way the 3-band version is — that per-band normalization
    // doesn't generalize cleanly to ~150 independent bins, and the
    // visualizer applies its own log-compression + track-peak scaling
    // instead (see SPECTRUM_* constants in CRTVisualizer.jsx).
    getSpectrumFrame: (pointCount) => {
      const channel = decodedChannelRef.current;
      const ws = wsRef.current;
      if (!channel || !ws || !pointCount) return null;

      const sampleRate = sampleRateRef.current;
      if (!fftRef.current || fftRef.current.sampleRate !== sampleRate) {
        fftRef.current = new FFT(FREQ_FFT_SIZE, sampleRate, 'hann');
      }
      const fft = fftRef.current;
      const buffer = fftBufferRef.current;

      const centerSample = Math.floor(ws.getCurrentTime() * sampleRate);
      const start = Math.max(0, Math.min(channel.length - FREQ_FFT_SIZE, centerSample - FREQ_FFT_SIZE / 2));
      for (let i = 0; i < FREQ_FFT_SIZE; i++) {
        const s = start + i;
        buffer[i] = s < channel.length ? channel[s] : 0;
      }

      let spectrum;
      try {
        spectrum = fft.calculateSpectrum(buffer);
      } catch {
        return null; // e.g. a track shorter than one FFT window
      }

      if (!spectrumFrameRef.current || spectrumFrameRef.current.length !== pointCount) {
        spectrumFrameRef.current = new Float32Array(pointCount);
      }
      const out = spectrumFrameRef.current;
      const binWidth = sampleRate / FREQ_FFT_SIZE;
      const nyquist = sampleRate / 2;
      const minHz = Math.min(SPECTRUM_MIN_HZ, nyquist - 1);
      const maxHz = Math.min(SPECTRUM_MAX_HZ, nyquist);
      const logRange = Math.log(maxHz / minHz);
      for (let p = 0; p < pointCount; p++) {
        const loHz = minHz * Math.exp((logRange * p) / pointCount);
        const hiHz = minHz * Math.exp((logRange * (p + 1)) / pointCount);
        const i0 = Math.max(0, Math.floor(loHz / binWidth));
        const i1 = Math.max(i0, Math.min(spectrum.length - 1, Math.floor(hiHz / binWidth)));
        let sum = 0;
        for (let i = i0; i <= i1; i++) sum += spectrum[i];
        out[p] = sum / (i1 - i0 + 1);
      }
      return out;
    }
  }));

  return (
    <div
      className="waveform-hover-zone"
      style={{ width: '100%' }}
      onWheel={(e) => {
        // proportional to scroll magnitude and clamped, so a trackpad scrubs
        // finely while a mouse wheel notch still moves a sensible amount
        const amount = Math.max(-2, Math.min(2, -e.deltaY * 0.01));
        wsRef.current?.skip(amount);
      }}
    >
      <div ref={containerRef} style={{ width: '100%', cursor: 'pointer' }} />
      <div className="waveform-eq" aria-hidden="true">
        {Array.from({ length: EQ_BAR_COUNT }).map((_, i) => (
          <div key={i} ref={(el) => (eqBarRefs.current[i] = el)} className="waveform-eq-bar" />
        ))}
      </div>
    </div>
  );
});

export default Waveform;
