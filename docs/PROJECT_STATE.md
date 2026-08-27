# PROJECT_STATE.md — Sona

Living, frequently-changing status doc. Read `../CLAUDE.md` first for the permanent
architecture/conventions context this builds on. Update this file as work progresses —
move finished items out of "unfinished," log new bugs as they're found, and keep
"just finished" trimmed to roughly the last session or two, not the full history.

_Last updated: 2026-08-26, 2nd laptop session — electron:dev block re-diagnosed (see
below), electron bumped to 31.7.7 + lockfile synced, dead `allowScripts` block removed
from package.json._

## Working across two machines now (desktop + laptop)

The project is a git repo, backed up to a **private** GitHub repo:
`https://github.com/GriffinChaney/sona`. Both the desktop and Griffin's laptop
(`Griffins-MacBook-Pro`, macOS 14.6) have their own clone, authenticated via `gh`
(GitHub CLI). Normal flow: `git pull` before starting work, `git add -A && git commit
-m "..." && git push` when done. `claude` (Claude Code CLI) is installed on both
machines now, so either one can run its own independent session — **a new session on
the laptop does NOT share this conversation's history**; it relies on this file +
`../CLAUDE.md` for context, which is exactly why they exist. If you're picking this
project up in a fresh session, read both before changing anything.

### Laptop-specific setup notes (don't repeat this diagnosis if it comes up again)

- Laptop's Homebrew installed **Node 26.7.0** (bleeding-edge, not LTS) as the default
  `node`. This caused `extract-zip` (used by Electron's own install script) to fail
  **silently** — no error, no output, just never wrote `node_modules/electron/dist`.
  Fixed by installing `node@22` via Homebrew (keg-only) and prepending it to `PATH` in
  `~/.zshrc`. If Electron ever silently fails to install again on a machine, check
  `node --version` first — anything not an LTS release (even-numbered major, e.g. 20,
  22, 24) is suspect.
- **`npm run electron:dev` still doesn't work on the laptop.** The raw
  `node_modules/electron/dist/Electron.app` is `SIGKILL`ed on launch (exit 137) — even
  `Electron --version` is killed. Confirmed **not** version-specific (tried both 31.3.0
  and 31.7.7).
  - **Diagnosed 2026-08-26 (2nd laptop session):** the kill is `AppleSystemPolicy`
    (`syspolicyd`), not XProtect malware. Live log while launching:
    `kernel (AppleSystemPolicy) ASP: Security policy would not allow process: .../Electron.app/Contents/MacOS/Electron`
    and `syspolicyd [com.apple.syspolicy.exec] Evaluating blocked code: PST: ...
    (team: (null)), (id: com.github.Electron), (bundle_id: (null))`. So the block keys
    off the **ad-hoc signature + `com.github.Electron` signing identity + null team** —
    a Gatekeeper *execution* policy block, and this class has no "Open Anyway" override
    in System Settings.
  - Odd data point: `spctl -a -vvv -t exec node_modules/electron/dist/Electron.app`
    reports `accepted, source=SonaDev` — i.e. a `SonaDev` spctl label rule was added at
    some point (`spctl --add --label SonaDev ...`), and `spctl` *says* accepted, yet the
    kernel ASP layer still kills it. spctl labels don't override the ASP exec block here.
  - No quarantine xattr is present (`xattr -l` empty), so `xattr -dr com.apple.quarantine`
    won't help.
  - **Workaround still in place**: packaged-app flow (`npm run electron:build`, then
    codesign — see CLAUDE.md) instead of live-reload dev mode on the laptop.
  - **Untried next angles** (deferred at user's request — low priority, packaged flow
    works): (a) re-sign the dist bundle with a *fresh signing identifier*
    `codesign --sign - --force --deep --identifier com.sona.electron-dev node_modules/electron/dist/Electron.app`
    and retest — the ASP log pins the block to `id: com.github.Electron`, so a new id
    may clear it without a full rename; (b) failing that, the full rename (rename the
    `.app` + `Contents/MacOS/Electron` executable, update `Info.plist`
    `CFBundleName`/`CFBundleExecutable`/`CFBundleIdentifier`, update
    `node_modules/electron/path.txt`, re-sign); (c) either survives only until the next
    `npm install`, so it'd need a `postinstall` script to be durable.
- SSH access from desktop→laptop was set up temporarily (key added to laptop's
  `~/.ssh/authorized_keys`, labeled `griffin-desktop-to-laptop`) to speed up debugging
  the above. Only works when both machines are on the same LAN. Not removed — ask
  Griffin if it should be revoked once no longer useful.

## Just finished (most recent session before the above)

Two back-to-back reminders-list batches, each rebuilt/re-signed/reinstalled to
`/Applications/Sona.app`:

**Batch 1 — icon + window/UX fixes:**
- **App icon**: generated a retro pixel-art rainbow-CD icon from scratch (no source
  image available) — a pure-Python PNG writer (`assets/icon-source.png`, 1024×1024,
  upscaled nearest-neighbor from a 64×64 grid) piped through `sips`/`iconutil` into
  `assets/icon.icns`. Wired into `package.json`'s `build.mac.icon` for packaged builds
  and into `electron/main.js` (`BrowserWindow`'s `icon` option + `app.dock.setIcon` in
  dev) so the dev-mode dock icon matches too. Also added `assets/icon-256.png` /
  `public/assets/icon-256.png` as a browser-tab favicon.
- **Window dragging**: `titleBarStyle: 'hiddenInset'` leaves nothing draggable by
  default once content fills the window. Added a `.drag-strip` (fixed, top 34px,
  `-webkit-app-region: drag`) in `App.jsx`/`styles.css` for sidebar/focus view. Mini
  mode instead makes the whole `.mini-player` card draggable with interactive children
  (`.mini-artwork`, `.mini-transport`) opted back out via `no-drag`.
- **Mini mode traffic lights removed** via `win.setWindowButtonVisibility(false)` in
  `enter-mini-mode` (restored on exit) — the card itself is the drag handle now.
- **Waveform progress-color theme bug fixed**: color was only recomputed at
  WaveSurfer-instance creation (keyed off `audioUrl`), so toggling theme without
  switching tracks left it stale until the next track load. `Waveform.jsx` now takes a
  `theme` prop and calls `ws.setOptions({ progressColor })` in a separate effect keyed
  off `theme`.
- **Spacebar not starting playback fixed**: the keydown handler called
  `waveformRef.current?.toggle()` directly instead of `handleTogglePlay`, so pressing
  space while browsing a track that wasn't loaded into the audio engine yet was a
  no-op. Now calls `handleTogglePlay()`, same adopt-and-play logic the on-screen play
  button already used.
- **Queue drag-to-reorder** added (was previously add/remove only).
- **Mini window moved** from bottom-left to top-left of the screen.

**Batch 2 — reminders-list polish + a queue reorder bug fix:**
- **Selection highlight** (`.track-item.selected`, multi-select) changed from purple
  to a new macOS-style `--selection`/`--selection-bg` blue.
- **Queue drag-reorder UX overhaul**: replaced whole-row highlight with a precise
  insertion line computed from cursor position within the hovered row. Queue entries
  changed from bare track ids to `{ qid, trackId }` so the **same song can be queued
  more than once** (ids alone couldn't identify a specific entry for React keys/removal).
- **Queue reorder bug fix (same session, after user re-test)**: drops still
  sometimes landed one song off from the cursor. Root cause — the insertion-line
  indicator was rendered in normal document flow, so its appearance/disappearance
  nudged row positions live during the drag, which fed back into the next
  `dragover`'s position calculation. Fixed by making `.queue-drop-line` absolutely
  positioned (`.queue-item-wrap { position: relative }`) so indicator rendering never
  affects row layout. **Not yet re-confirmed by the user after this specific fix.**
- **Artwork placeholder color**: all "no artwork" fallback backgrounds (track
  thumbnails, Now Playing/Focus artwork, mini player artwork, background-bar thumb)
  changed from purple (`--accent-dim`) to a new neutral `--placeholder-bg`.
- **Settings dark/light toggle** changed from purple to the same neutral
  text-on-inverted-background style already used for tag-filter buttons.
- **Focus view ambient background**: new Spotify-style radial gradient sampled from
  the current track's own artwork (`src/lib/dominantColor.js` — downscales to a 48×48
  canvas, averages pixels weighted toward saturated/mid-lightness ones to avoid a
  muddy gray average; `src/lib/useDominantColor.js` hook re-samples on track switch).
  Applied as an inline `background` style on `.focus-view`, `transition: background
  0.6s ease` for a crossfade on track change. Falls back to the plain theme background
  when there's no artwork or the sample hasn't resolved yet.

## Just finished (earlier session)

A large batch of fixes/features landed together, then the packaged app was rebuilt,
re-signed, and reinstalled to `/Applications/Sona.app`:

- **Root-caused and fixed the "clicking another track pauses playback" bug** —
  `<WaveformSlot>` was being conditionally unmounted, detaching the underlying
  `<audio>` element from the document (which browsers auto-pause). Now always
  rendered; hidden via CSS overlay instead. See CLAUDE.md's "Single shared WaveSurfer
  instance" section — this is the most important fix in the project's history so far
  and the pattern must be preserved.
- **Decoupled browsing from playback** (`currentTrackId` vs `playingTrackId`) —
  clicking a track now only browses it; double-click/play-button/skip actually change
  what's playing. `BackgroundPlayBar` surfaces the real playing track while browsing
  elsewhere.
- **Real mini-player window** — replaced the fake in-window widget (rejected by user:
  "leaves a huge big grey empty box") with an actual `BrowserWindow` resize via new
  IPC (`electron/preload.cjs` + handlers in `electron/main.js`). This required
  renaming `preload.js` → `preload.cjs` (ESM/CJS loading issue) and was the reason
  for a full app rebuild rather than just a dev reload.
- **Throttled `currentTime` updates to 200ms** — root cause of general
  "laggy/buggy/needs two clicks" complaints; raw `audioprocess` events were
  re-rendering the whole app many times a second.
- **Auto-advance now forces `autoPlay: true`** on natural track-finish, independent of
  ambient `isPlaying` state at that instant (was previously relying on a closure value
  that could theoretically race).
- **Hidden title bar** (`titleBarStyle: 'hiddenInset'`) for a cleaner window chrome;
  added top padding to `.sidebar`/`.back-btn` so traffic lights don't overlap content.
- **Play queue** — basic but functional: `+` button per track (hover-reveal, next to
  delete), "up next" panel in the sidebar, consumed before falling back to
  library-order on skip/finish. **Not persisted** across app restarts.
- **Resizable sidebar** — drag handle at the sidebar's right edge, persisted to
  `localStorage` (`sidebarWidth`).
- **Tag-group delete** — an `×` on each tag-filter chip removes that tag from every
  track at once (`handleDeleteTagGroup`).
- **Light-mode fixes**: upload-button hover was hardcoded near-black regardless of
  theme (fixed to `var(--border)`); waveform "played" region contrast bumped for
  light mode specifically (`rgba(0,0,0,0.5)` vs dark mode's `rgba(255,255,255,0.3)`);
  purple removed from tag-filter chips in both themes.
- **Refined scroll-to-scrub** — proportional to scroll delta (±2s clamp) instead of a
  flat 3s per wheel event.
- **BackgroundPlayBar redesign** — wider, shows artist now (not just title), added a
  small 5-bar reactive pixel meter (`getAmplitude()` off the Waveform ref), and fixed
  centering to account for sidebar width in sidebar view (was centering on the whole
  window, which read as off-center relative to the visible content area).
- **Subtle hover animations** added broadly: tracks, transport buttons, waveform
  container, upload/tag buttons, search input — per repeated "Apple-like, subtle"
  requests.
- Renamed app `my music player` → **Sona** throughout (window title, package name,
  productName, appId). **Note:** IndexedDB database name was *not* migrated and is
  still `"my-music-player"` internally — harmless, but see CLAUDE.md.

## Known bugs / open issues

- **Not yet re-verified after the latest rebuild**: the user reported (in the same
  message that led to the throttle fix) that clicking through tracks "still sometimes
  takes two clicks" and generally felt laggy. The throttle fix targets the most likely
  root cause, but this has not been explicitly confirmed fixed by the user yet in a
  follow-up message. **Ask or check before assuming it's resolved.**
- ~~**`handleReady`'s resume-position logic is dead code.**~~ **Fixed 2026-08-26** —
  deleted the dead `if (currentTime > 0 && dur > 0) seekTo(...)` branch (and its now-
  unneeded `eslint-disable`). It never fired (empty-deps `useCallback` froze
  `currentTime` at 0) and isn't needed: `onReady` only fires on a real track switch,
  for which `handleAdoptAndPlay` already zeroes `currentTime`, and view swaps reparent
  the same waveform node without re-firing `ready`. A comment in `handleReady` now
  records why there's deliberately no resume here.
- **Queue is not persisted.** Restarting the app loses any manually-queued tracks.
  Not reported as a bug yet, but worth knowing before someone asks "why did my queue
  disappear."
- IndexedDB store name mismatch (`my-music-player` vs the app's actual name `Sona`) —
  cosmetic/internal only, see CLAUDE.md.

## Things tried that didn't work (don't repeat without a new angle)

- **Fully transparent waveform `progressColor`** to stop the "changes color when I
  scrub" complaint — fixed that complaint but made the played region invisible in
  both themes. Landed on theme-aware translucent instead (see CLAUDE.md).
- **Fake in-window mini player** (a floating card inside the still-full-size window)
  — explicitly rejected by the user; replaced with a real `BrowserWindow` resize.
- **Whole-waveform-container transform/glow pulse** as "the visualizer" — user said
  "I don't see it bouncing at all... barely visible." Replaced with the dedicated
  pixel-art EQ bar strip (`renderHeatmapBars` + `.waveform-eq`), which samples the
  same real decoded-audio data but renders as discrete, chunky, independently-colored
  bars instead of a subtle whole-block effect.
- **Diagnosing artwork/metadata failures by testing the parser in plain Node** — gave
  a false negative (metadata parsed fine in Node) because Node has a real `Buffer`
  global; the actual bug only reproduced inside the Electron renderer. If a
  browser-only library misbehaves only in-app, don't trust a Node-based repro script
  to rule out the library — test inside the renderer (console forwarding from
  `electron/main.js` makes this easy: check the terminal running `electron:dev`).
- **ESM preload script** (`electron/preload.js` using `import`) — threw `Cannot use
  import statement outside a module` because `package.json` has `"type": "module"`.
  Renamed to `.cjs` + `require()`, which forces CommonJS regardless of the package
  type field.

## Unfinished / explicitly deferred

- **"A lot of modern songs... like a streaming platform"** — user asked how hard this
  would be. Answered as a discussion point (needs a licensed catalog via a service
  API, e.g. Spotify/Apple Music, plus a backend — fundamentally a different app), not
  attempted. No further action unless the user explicitly wants to pursue it knowing
  the scope.
- Real fullscreen / other genuine OS-level window behaviors beyond mini-mode haven't
  been requested yet, but given the mini-mode precedent (fake version rejected, real
  version built), default to the real OS behavior if asked rather than an in-app
  simulation.

## Suggested next steps / things to test

1. Confirm with the user whether the click-lag/"two clicks" issue is actually resolved
   post-throttle, in a real testing session (not just code review).
2. Consider persisting the queue to IndexedDB/localStorage if the user starts relying
   on it across sessions.
3. Either fix or remove the dead `handleReady` resume-position branch (see "Known
   bugs" above) — small cleanup, not urgent.
4. If IndexedDB is ever touched for a schema change, consider whether to also rename
   the database from `my-music-player` to something Sona-branded, with a proper
   migration (don't just rename and orphan existing users' data).
