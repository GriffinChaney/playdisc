# Crossfade — scoped, shelved (2026-09-07)

Investigated on request; **not implemented, not scheduled**. This is a scoping
record so a future session (or Griffin, later) doesn't have to redo the
investigation. If you pick this up: read this whole file before writing code,
and resolve the open questions below with Griffin first — they were never
answered.

## The ask

An opt-in crossfade on natural track end: current behavior (play through,
hard cut to next) becomes the default, with an on/off toggle and adjustable
fade length in Settings. Manual skip stays instant regardless of the setting.

## What's confirmed

Exactly **one** `<audio>` element exists today. `Waveform.jsx`'s single
`WaveSurfer.create()` (MediaElement backend) is destroyed and rebuilt on every
track switch, keyed only on `audioUrl`. A crossfade needs a second,
independent `<audio>` element for the outgoing track's fade-out tail, plus the
"decide next track early" split described below. Preloading the next track
falls out for free once the early-trigger exists — starting the real switch
early *is* the preload; it isn't separate work.

## Five functions in `App.jsx` this touches

"Decide what's next" and "switch to it" are currently one atomic step and
have to be split apart:

1. **`handleTimeUpdate`** — already fires every ~200ms off the existing
   throttle (do not lower this — see CLAUDE.md "Things Claude should never
   break"). The crossfade-start check (`duration - t <= fadeLength`) rides on
   it for free, no new polling.
2. **`handleFinish`** — its next-track decision tree (repeat-one, history
   retrace, queue drain, shuffle advance + wrap/repeat interaction, sequential
   step) has to be extractable so it can run once, early, with its side
   effects landing exactly once — not once early and again when the real
   `'finish'` event eventually shows up on the old audio.
3. **`handleAdoptAndPlay`** — the one real choke point (14 call sites: skip,
   browse, queue, history nav, header play buttons). Cancelling any in-flight
   fade-out belongs at its top; the crossfade's own call into it must not
   cancel the fade it just started.
4. **`handleReady`** — currently always does `setVolume(fullVolume)` then
   `play()` on every track load. Has to become conditional: start silent, ramp
   up, without changing the normal hard-cut path's behavior.
5. **New state/module for the fade itself** — the standalone outgoing-audio
   element and its volume ramp.

## Two real risks

- **Decode latency on large lossless WAVs.** `onReady` only fires once
  WaveSurfer has decoded enough to compute waveform peaks. Invisible on a hard
  cut; load-bearing during a crossfade — if the new track's `ready` lags the
  fade window, there's an audible gap (old track already silent, new one not
  started yet), the opposite of the feature's point.
- **Fade curve.** Two linear ramps summed dip in perceived loudness mid-fade;
  needs an equal-power curve, not linear.

## Decisions made (confirmed, none implemented)

- Pause mid-crossfade collapses immediately onto the new track (does not
  freeze both elements).
- Equal-power fade curve, not linear.
- If the new track isn't decoded yet when the fade should start, **delay the
  switch** rather than falling back to a hard cut.
- Both live in Settings: an on/off toggle and a fade length, default ~5s when
  enabled. Current hard-cut behavior stays the default; crossfade is opt-in.
- Crossfade only on natural track end. Manual skip stays instant.
- Skipping mid-crossfade must not leave an orphan playing.

## Open questions (never resolved — ask before building)

1. Do cover art, title, and the playing-track indicator snap at fade start
   alongside the waveform, or cross-dissolve across the fade?
2. Does a late decode (new track not ready when the fade should start)
   produce a *shortened* fade once it catches up, or does the delayed switch
   always play the full configured fade length starting late?
3. Does repeat-one crossfade a track into itself, or hard-cut?

## Known-bad interactions with this library specifically

- **Cubase bounces with trailing silence** will crossfade into that silence
  and sound wrong — the fade timer is driven by `duration`, which doesn't
  know the audible content ends earlier than the file does.
- **The fade ramp has to compose with the existing volume slider**, not write
  raw values to `element.volume` — the ramp needs to scale relative to
  whatever `volumeRef.current` currently is, the same way `handleReady`
  already re-applies it per track (see CLAUDE.md's `volume` state notes).
