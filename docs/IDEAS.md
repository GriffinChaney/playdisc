# IDEAS.md — Playdisc

Parked features: built, working, and deliberately kept off `main` because they
didn't earn a permanent place — not bugs, not unfinished in the sense of broken,
just shelved. Each entry names the branch it lives on and what it'd take to bring
back. See `../CLAUDE.md` for permanent architecture, `PROJECT_STATE.md` for
current in-progress work.

## CRT waterfall visualizer — branch `crt-visualizer`

Full-screen audio-reactive spectrogram, entered from a corner button in
FocusView: an Unknown-Pleasures-style waterfall of receding ridge lines, each
one a full FFT frame, in fake 2D perspective (no WebGL — a per-line offset,
not real 3D math). Built, working, tuned across two review passes. Pulled off
`main` after live review: it didn't fit the app, not because anything was
broken.

**What it does**: reuses `Waveform.jsx`'s existing decoded-PCM + wavesurfer
FFT pipeline (a new `getSpectrumFrame(pointCount)` on its imperative handle)
to drive a black-background, white-line waterfall — plain Joy Division look,
not the red/CRT-treatment version this started as (see below). Escape and
Cmd+W both exit back to fullscreen, wired into the same priority-chain /
stopPropagation patterns every other modal-ish surface in this app uses.

**Left unresolved when parked:**

- **Perspective still didn't fully match the reference image** even after a
  second tuning pass that pushed the horizon higher, steepened the
  convergence, and shrunk distant lines harder. If revived, this is the
  single biggest thing to keep iterating on — see `CRTVisualizer.jsx`'s
  "Perspective geometry" constants block.
- **Performance was never actually verified.** It was *profiled* — twice, with
  an isolated canvas benchmark outside the app — but the sandbox this was
  built in couldn't produce a trustworthy number: the same draw code
  benchmarked at wildly different costs (~0.6ms one run, ~4ms the next) in a
  same-session A/B, which means the environment's own canvas performance
  isn't stable enough to trust, not that the code is that inconsistent. The
  one real signal from that comparison: old (red, 3-pass glow + chromatic
  fringe) and new (white, 1-pass) drawing cost landed within noise of each
  other every time, which points *away* from the glow passes as the
  dominant cost and *toward* the CRT overlay that got removed alongside it
  (three extra always-composited full-window layers, one continuously
  animating) as the more likely one — but that was never confirmed against
  the real packaged app with real audio playing. Whoever picks this back up
  should profile in the real app directly first; there's no reliable way to
  do it from a sandboxed dev environment.
- Whether the look is even wanted at all was the actual reason it got
  pulled — re-litigate that before spending more time on the above.

**To bring it back**: `git log crt-visualizer` for the full history; the tip
commit's message documents exactly where the perspective/mirroring/edge-
overflow constants and the performance findings landed. Re-applying it to
`main` means re-adding: `src/components/CRTVisualizer.jsx` and
`CRTIcon.jsx` (new files), a `getSpectrumFrame` method on `Waveform.jsx`'s
imperative handle, a `'visualizer'` case in `App.jsx`'s `view` state (with
its own Escape branch, checked before the generic fullscreen/mini-exit
case), and the corner button in `FocusView.jsx`. None of those touch
anything else in the views/state they sit alongside — safe to `git diff
main crt-visualizer` for the exact shape before merging.
