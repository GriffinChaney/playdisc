# PROJECT_STATE.md — Sona

Living, frequently-changing status doc. Read `../CLAUDE.md` first for the permanent
architecture/conventions context this builds on. Update this file as work progresses —
move finished items out of "unfinished," log new bugs as they're found, and keep
"just finished" trimmed to roughly the last session or two, not the full history.

_Last updated: 2026-08-27 — playlist system, 3-column library view, play history, and
several batches of view/UX polish all shipped and user-confirmed in the packaged app.
Recent: zone proportions locked to a user-approved screenshot (one-time layout reset,
now `layoutDefaults='v2.5'`), `v` grid⇄list toggle w/ staggered swap animation, Z zoom
follow-mode + per-track fidelity info, Escape clears/blurs search. **Desktop session**
(commits `dd634f1`..`4bfc65f`) added folder import (recursive, single native dialog),
import-crash fix, `×`-acts-on-selection, mini-player tweaks, and a fix for the layout
ratcheting smaller on every resize. **Laptop, latest**: multi-color mesh gradient
fullscreen backdrop, and a tag-picker combobox (`TagMenu`) with bulk add/remove. See
"Just finished"._

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

### Backups

`npm run backup` (`scripts/backup.sh`) writes a timestamped `git archive` zip of
HEAD to **`~/Developer/sona-backups/`** and auto-prunes to the newest 15. Run it
after committing, alongside cutting a checkpoint tag. (Older ad-hoc zips lived in
`~/Downloads/` — those are historical; the folder is the system now.) Git tags are
the primary revert mechanism regardless; the zips are just belt-and-suspenders.

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
  - **More digging, 2026-08-26 (same session):** fuller `syspolicyd` log during a
    launch attempt:
    ```
    GK evaluateScanResult: 2, PST: (vuid: 5D053D89-...), (team: (null)), (id: (null))
    Prompt shown (2, 0), waiting for response
    Terminating process due to Gatekeeper rejection
    ```
    So it's a Gatekeeper **prompt** verdict (scanResult 2 = "unverified developer, ask
    the user"), and a GUI dialog *is* shown — headless launches (scripts, `electron:dev`)
    just have nobody to click it, so it times out (~15–20s) and gets SIGKILLed.
  - **Things tried this session that did NOT fix it:**
    - Re-sign with a fresh identifier (`--identifier com.sona.electrondev`) — still
      killed. So the block is **not** just the `com.github.Electron` name; a rename is
      unlikely to be the answer.
    - `xattr -rc` — `com.apple.provenance` / `com.apple.macl` xattrs are protected,
      can't be removed without root; didn't help anyway.
    - The old `SonaDev` `spctl` label rule (`2719[SonaDev] P0 allow execute [...Electron.app]`)
      is now **stale** (re-signing changed the cdhash); `spctl -a` reports `rejected`.
    - `open`-ing the bundle from Finder to get the dialog → **"Open Anyway" does NOT
      appear** in System Settings › Privacy & Security (user confirmed). This class of
      block really has no GUI override.
  - **Only remaining paths, all needing the user's password in the terminal** (deferred
    — packaged flow works, ~2 min/iteration):
    - `sudo spctl --add --label SonaDev node_modules/electron/dist/Electron.app` (re-add
      the rule against the *current* cdhash) — but a prior `spctl` "accepted" still got
      ASP-killed, so low confidence.
    - `sudo xattr`/`sudo spctl --master-disable` (disables Gatekeeper globally — heavy
      hammer, not recommended).
    - Full bundle rename — low confidence given the identifier test above.
  - **Workaround in place**: packaged-app flow (`npm run electron:build`, then codesign
    — see CLAUDE.md) instead of live-reload dev mode on the laptop.
- SSH access from desktop→laptop was set up temporarily (key added to laptop's
  `~/.ssh/authorized_keys`, labeled `griffin-desktop-to-laptop`) to speed up debugging
  the above. Only works when both machines are on the same LAN. Not removed — ask
  Griffin if it should be revoked once no longer useful.

## Just finished (2026-08-28 — playlist edit + grid fill)

All user-confirmed in the packaged app.

- **Playlist edit modal** (`PlaylistEditModal.jsx`). Right-click playlist → "Edit…"
  (Rename kept). Name + optional description + optional cover image. New playlist
  fields `description` / `imageBlob` (no DB migration). `src/lib/imageResize.js`
  downscales the image to ≤600px. Cover box accepts a file picker *or* drag-drop.
  Backdrop = `.modal-overlay-blur` (~3px blur). When a playlist has an image and/or
  description, `LibraryList` shows a `.playlist-hero` band above the list instead of
  the plain header; with neither it's unchanged.
- **Grid = exactly 4 columns**, `repeat(4, minmax(0,1fr))` + `scrollbar-gutter:
  stable`. The old `auto-fill, minmax(190px,1fr)` dropped to 3 once the vertical
  scrollbar appeared and shaved the width.



- **Fullscreen backdrop → multi-color mesh gradient** (tag `v2.5-mesh-backdrop`).
  `dominantColor.js` `getArtworkPalette()` + `useArtworkPalette` hook; `FocusView`
  renders 4 soft radial blobs over a dark base. Monochrome covers fan the one hue
  into analogous tones. See the "Focus view ambient background" entry lower down.
- **`TagMenu.jsx`** — new combobox popover replacing the inline `+ tag` input
  everywhere:
  - Opens with all existing tags listed (from `LibraryList`'s `allTags`); typing
    narrows; non-match → "Create …" row. Picking keeps the menu open; Esc / click /
    scroll closes. Portal + `position: fixed`, flips up when < 240px below the anchor.
    Input autofocuses once positioned.
  - Row `+ tag` while that row is in a multi-selection → applies to the whole
    selection (`handleRowAddTag` → `menuTargets`), with an "adding to N songs" note.
  - Bulk bar: `+ tag` (menu, `allTags`) and a new `− tag` (shown only when the
    selection has tags; options = union of tags on selected tracks; removes from all).



**Follow-up pass, same day (after packaged testing):**
- **Tab reverted to the even split.** `--np-width` when collapsed is `viewportW / 2`
  again (list + artwork split the whole window); the user liked that and only wanted
  the *return* trip fixed. Toggling Tab off now lands exactly back on the default
  because both resize handles are `display:none` while collapsed — a live np handle
  sat mid-window and an accidental grab was saving a tiny width that then stuck.
- **One-time layout reset** in `App.jsx` (localStorage `layoutDefaults`, now `'v2.4'`)
  wipes stale `npWidth`/`navWidth` once so the measured default (`236 / ~860 / ~803`
  at 1899px) actually applies. Bump the string on any future default re-tune.
- **Audio-fidelity info moved out of NowPlaying.** The user wanted the right column
  kept to title + artist only. Format/quality now shows **only** in the Z-zoom strip.
- **Quality badge de-colored** — was a teal→blue gradient, now plain on-theme text.



- **Middle / right zone rebalance.** The responsive `--np-width` (right/artwork
  column) went from `~26vw` clamped 320–480 to **~48.3% of the space left after the
  nav** — computed as `max(320, min(1400, round((viewportW - navWidth) * 0.483),
  avail - 340))`. Numbers were measured off a screenshot the user marked as the
  target: at ~1899px wide it lands `236 / 860 / 803` (nav / list / artwork). Left-nav
  default 200→**236**. Artwork/waveform CSS caps `min(46vh,460px)` → `min(58vh,860px)`
  so the art actually fills the wider column. Drag ceiling on the np handle 640→1400.
  Only applies when the handles haven't been dragged (a dragged width is persisted and
  wins).
- **`v` = grid ⇄ list toggle.** New rebindable keybinding `toggleLibraryView`
  (default `v`), added to `DEFAULT_KEYBINDINGS` so it shows in Settings. Switches to
  the library view first if you're in focus/mini.
- **Z zoom is now a follow-mode.** `expandTrack` (Z) toggles "keep the current track
  zoomed"; while on, an effect in `App.jsx` keyed on `currentTrackId` moves
  `expandedTrackId` to whatever you skip / browse / finish onto. The zoomed row
  auto-scrolls into view (`TrackItem` effect: `requestAnimationFrame` +
  `scrollIntoView({ block: 'nearest' })` — **instant, not `behavior: 'smooth'`**; the
  smooth version churned against the row's own growing height and hard-froze the
  renderer on rapid clicks).
- **Zoomed row shows an info strip** (`.track-expanded-info` in `TrackItem.jsx`):
  quality badge + codec / sample-rate / bit-depth-or-bitrate chips (from new
  `src/lib/audioQuality.js`), then size, date added, duration, tag count. `parseTrack`
  now captures `metadata.format` into a new `track.audio` field.
- **Grid/list swap animation.** `.track-list` / `.track-grid` get `.view-swap`
  (`view-enter` keyframe, ~240ms). Grid tiles pop in staggered top-left→bottom-right
  via a per-tile `--stagger` delay (`grid-tile-in`). Respects reduced-motion.
- **Escape in search** clears a non-empty query, then blurs.



- **Playlist system + 3-column library view** (big one — backup tag
  `pre-playlists-2026-08-26`, zip `~/Downloads/sona-backup-20260826-2204.zip`):
  - DB v1→v2: new `playlists` store `{ id, name, trackIds[], pinned, createdAt,
    updatedAt }`. Playlists are ordered id-lists; deleting one never touches tracks.
  - `view === 'sidebar'` is now 3 columns: `PlaylistNav` (left) / `LibraryList`
    (middle) / `NowPlaying` (right). Fullscreen + mini untouched. Old monolithic
    `Sidebar.jsx` split into PlaylistNav + LibraryList + extracted QueuePanel +
    HistoryPanel. New `ContextMenu.jsx` (reusable right-click menu w/ 1-level submenu).
  - "Imported" left-nav item = the whole library. Playlists below it, pinned first.
  - Add-to-playlist via track right-click or the `+ playlist` bulk-bar button (both
    honour multi-select). Right-click a playlist → Play / Pin / Rename / Delete.
  - `playbackContext` state: skip/auto-advance follow the playlist you started
    playing from, else library order.
  - Extras done this pass: list⇄grid toggle (persisted), drag-reorder within a
    playlist (disabled while searching/filtering), "N songs · M min" subtitle.
  - Verified in dev build: 3-col layout, create/rename/pin/delete playlist, add via
    menu + bulk, delete-preserves-library, playlist playback order, grid toggle,
    drag-reorder, persistence across reload, fullscreen + mini still fine.
  - Follow-up fixes (same session, after user tested the packaged build):
    - **Add-to-playlist was broken** — the "New playlist…" flow used `window.prompt()`,
      which Electron doesn't implement. Replaced with `<PromptModal>` (App `promptConfig`
      state). `window.confirm()` is fine, still used.
    - **Click lag regressed** — App was handing `LibraryList` a freshly-built
      `shownTracks` array every render (incl. every 200ms currentTime tick), forcing a
      full list re-render. Fixed: `useMemo` on `shownTracks`, `React.memo` on
      LibraryList + PlaylistNav.
    - Right now-playing column is now bigger (default 340) and **drag-resizable** (handle
      on its left edge, `npWidth` / `localStorage.npWidth`, clamped to keep middle ≥300).
      Electron min window width 820→900.
    - **`Tab`** slides the left playlist nav out of view / back (`toggleNav` keybinding,
      in Settings). Grid `--nav-width`→0 + slide animation.
    - Pin/unpin: added a hover pin button on each playlist row (was right-click only).
    - Subtle lift + shadow on grid-item hover.
  - Round 2 of follow-ups:
    - Column resize was laggy — `setState` per mousemove + a `transition:
      grid-template-columns` that can't interpolate a `1fr` track (left the grid
      stuck at a stale width). Now the drag writes `--nav-width` / `--np-width`
      straight to the `.app` node (zero re-render); state + `localStorage` commit on
      mouseup only. No grid transition at all now.
    - `Tab` collapses the nav to a **50/50 split** between the track list and the
      artwork zone (`--np-width: 50vw`); nav content slides out via its own transform.
    - Grid hover is transform-only now (box-shadow / filter transitions were the jank).
  - Round 3 (2026-08-27) — all **user-confirmed working in the packaged app**:
    - Context-menu submenu no longer stays stuck/highlighted (plain rows now reset
      `openSub` on hover).
    - Track-row `×` is context-aware: removes from the playlist you're viewing (no
      confirm, stays in library); only deletes from the library in the Imported view.
    - Window opens at ~Raycast "Almost Maximize" (work-area inset ~3%, centered).
    - General + focus views scale with window size: `npWidth` defaults to `null`
      (responsive auto width from a `viewportW` state); artwork/waveform sized off
      vh/vw; window-resize re-clamps pinned widths. Mini mode untouched.
    - Playlists drag-reorderable in the nav (`sortIndex`; within pinned/unpinned group).
    - Collapsed Tab view bumps the artwork cap way up.
    - `:active` press-down feedback on rows + buttons (pure CSS).
    - `--nav-width` / `--np-width` registered via `@property` so the Tab collapse
      *slides* (fed clean px only — see CLAUDE.md).
  - Shipped to `/Applications/Sona.app` (`4ad09f4`).


- **Play history / recently-played** (browser-style back/forward): new `history` +
  `historyIndex` state in `App.jsx`. Prev/Next transport (and `u`/`d` + arrow keys)
  now walk the real play trail — Back = last actually-played track, Forward retraces,
  playing something new mid-rewind truncates the forward tail. Backing past the oldest
  entry extends the trail backward in library order (prepend, no truncate). Collapsible
  "recently played" panel in the sidebar (click a row to jump; "clear" button;
  collapsed by default, state in `localStorage.historyPanelOpen`). Persisted to
  `localStorage.playHistory`; deleted tracks pruned. Verified in the dev build across
  all cases (append, back, forward-retrace, truncate, prepend-extend, list-click,
  reload persistence, clear). **Not yet in the packaged app** — needs a rebuild.
  - Hit and fixed a **StrictMode double-invoke bug**: side effects (ref writes,
    `setHistoryIndex`) inside a `setHistory(prev => …)` updater ran twice in dev, so a
    new play while stepped-back didn't truncate. Fixed by routing all history writes
    through `commitHistory`/`setHistoryPos` (plain-value setters). See CLAUDE.md.
- **Import UX** (`ed5b460`): new `ImportOverlay` (full-screen blurred backdrop +
  determinate `done/total` progress bar with an indeterminate sheen) shown while
  samples parse/write, and `ImportToast` (top-right "N samples imported", slides in →
  holds ~2.5s → slides off to the right → unmounts; red error variant on throw).
  `handleFilesSelected` reworked to report per-file progress and to `try/finally` so
  the overlay always clears. Verified in the browser dev build (Vite); **not yet
  tested in the packaged app** — needs a rebuild/re-sign/reinstall.
  - Note: CSS entrance animations pause when the tab/window is hidden; the overlay
    card keyframe starts at `opacity: 0`, so if you ever see a "dim empty card" it's
    just a hidden-window animation pause, not a bug.
- Committed the electron 31.7.7 bump + dropped dead `allowScripts` (see above), and
  removed the dead `handleReady` resume branch (`96ea4db`).

## Just finished (earlier — reminders-list batches)

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
- **Focus view ambient background** → **now a multi-color mesh gradient**
  (2026-08-27). `src/lib/dominantColor.js` gained `getArtworkPalette()`: buckets the
  cover's pixels into 18 hue bins, keeps the 4 heaviest that are ≥2 bins apart
  (distinct hues), normalizes each to a vivid backdrop tone; near-monochrome covers
  fan the one hue into ~4 analogous tones so the gradient still has depth (this is the
  Coldplay-*Parachutes* case the user explicitly liked). `useArtworkPalette` hook in
  `useDominantColor.js`. `FocusView` renders them as 4 soft `radial-gradient` blobs
  (corners, `rgba(...,0.85) → transparent 60%`) over a dark base derived from the
  dominant hue. `transition: background-color / background-image 0.6s` — color always
  crossfades, gradient layers crossfade when blob counts match else cut. Falls back to
  the old single-color radial (`getDominantColor`, still present) while the palette
  samples, then to the plain theme bg with no artwork.

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

- ~~**Click lag / "two clicks" to switch tracks.**~~ **Confirmed resolved by the user
  2026-08-26** — the 200ms `currentTime` throttle (`handleTimeUpdate` in `App.jsx`)
  fixed it: "feels way better, almost perfect." User notes a click still *very
  occasionally* fails to register — not enough to chase yet; revisit only if it gets
  worse. Do not remove or loosen the throttle.
- ~~**Queue drag-reorder landing one song off from the cursor.**~~ **Confirmed
  resolved by the user 2026-08-26** ("feels great right now") after the batch-2 fix
  (absolutely-positioned `.queue-drop-line` so the indicator never nudges row layout).
  Index math in `handleReorderQueue` reviewed and correct.
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
