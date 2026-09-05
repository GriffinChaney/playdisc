# Re-verifying the always-mounted WaveformSlot (view switches never pause audio)

Why this exists: the three waveform-bearing views (`NowPlaying`, `FocusView`,
`MiniPlayer`) must stay mounted at all times, with only one `active`. If that
invariant regresses — anything conditionally rendering one of them, or a new view
that doesn't follow the `active` contract — the shared `<audio>` host node gets
detached from the document on a view switch and the browser pauses it. This was
measured once (tag `waveformslot-fixed`): detach at t+0, reattach at t+14ms, native
`'pause'` at t+15.4ms — *after* reattachment, so it's a race the app only ever won
by luck. Full write-up: `CLAUDE.md`, "Single shared WaveSurfer instance".

Walk this after touching `App.jsx`'s view render, `WaveformSlot.jsx`,
`useGradientDrift.js`, or any of the three view components. It takes about ten
minutes. Test in the **packaged app**, not the dev build.

## Reaching each transition

- `f` — sidebar ↔ focus, and mini → focus
- `m` — sidebar → mini, focus → mini, mini → sidebar
- click the mini cover art — mini → sidebar
- Escape — focus → sidebar, mini → sidebar

## The matrix

Walk every row in each of the three states.

| # | Transition | Row-specific notes |
|---|---|---|
| 1 | sidebar → focus | drift starts if the cover has a palette |
| 2 | focus → sidebar | drift stops |
| 3 | sidebar → mini | window shrinks to 240×240, always-on-top |
| 4 | mini → sidebar | window size restores; try all three ways: `m`, cover click, Escape |
| 5 | focus → mini | one drift loop stops, one starts — never two alive |
| 6 | mini → focus | window restores; focus backdrop shows the **current** track (palette catch-up after the hidden-view freeze) |

### States

- **Playing** — the definitive signal is that the **elapsed time keeps counting**
  across the switch; a real pause freezes it. Also: ⏸ stays ⏸, no audible gap or
  stutter, waveform visible in the shown view.
- **Paused** — stays paused: ▶, elapsed time frozen at the same value, and it must
  **not** spontaneously start playing.
- **Nothing loaded** — fresh launch, never played. No crash, no red console
  errors, correct empty states ("select a track to start listening" / "nothing
  playing" / blank focus). No audio events are expected at all here — there is no
  WaveSurfer instance until a track loads.

### The originating bug

Playing state:

- **Cmd+, from mini** → back to sidebar, Settings opens, ⏸ stays, time keeps
  counting, sound continuous. Close Settings three ways — Escape, Cmd+W, ✕ — and
  each time: back to mini, window correct size and on top, still playing.
- **Cmd+, from sidebar** and **from focus** → Settings overlays, view untouched,
  no pause, closing leaves you where you were.

## If you need hard proof again

The verified fix shipped without logging. If a regression is suspected and the UI
signal isn't conclusive, temporarily re-add these (then remove them — none should
ship):

- In `WaveformSlot.jsx`'s claim effect: log `host.isConnected` before and after
  `appendChild`. Expect `wasConnected=true` on every switch (`false` only once,
  on the very first claim after launch). Add a cleanup that logs
  `UNMOUNTED` — it must **never** fire during a view switch; if it does, a view is
  being unmounted somewhere.
- In `Waveform.jsx`, on `ws.getMediaElement()`: listen for the native `'pause'`
  DOM event and log `isConnected`/`paused`. While playing there must be **zero**
  of these across any transition. Wrapping `.pause()` with a stack trace tells a
  code-initiated pause apart from a browser-initiated one (the bug was the latter:
  no stack, originating in `HTMLAudioElement` internals).
- In `useGradientDrift.js`: log loop start/stop. At any moment, "started" minus
  "stopped" must be ≤ 1. A track with no artwork produces no drift lines — that's
  expected, not a failure.
