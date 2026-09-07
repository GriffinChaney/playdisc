# CLAUDE.md — Playdisc

Permanent project knowledge for Claude Code. Read this before changing anything.
For what's currently in progress, broken, or next, see `docs/PROJECT_STATE.md`.

## What Playdisc is

> Renamed from **Sona** on 2026-09-01 (`915bbdc`). `productName`/`name`/`appId`
> (`com.playdisc.app`), window + document title, and the custom audio protocol
> (`sona-media://` → `playdisc-media://`) all changed. Because `productName`
> drives `app.getPath('userData')`, the profile moved to
> `~/Library/Application Support/Playdisc/`; `electron/main.js` has a one-time
> `migrateProfileFromSona()` that copies `IndexedDB/` + `Local Storage/` from the
> old `Sona/` profile on first launch (copy, not move — old profile kept).
> **Not renamed:** the `my-music-player` IndexedDB name (needs a real migration).
> The old `~/Music/Sona Library/` folder is **orphaned, not deleted** — since
> 2026-09-06 the library lives under a per-machine root in Dropbox (see "Library
> storage & sync" below); nothing reads that folder any more. Also left as-is: the
> `~/Library/Application Support/Sona/` frozen pre-migration profile snapshot,
> and the `~/Developer/sona-backups/` dir (holds `idb-pre-versioning/`).
>
> The GitHub repo and local dir **were** renamed on 2026-09-01: repo is now
> `github.com/GriffinChaney/playdisc` (GitHub redirects the old URL), local
> clone is `~/Developer/playdisc`.

A local-file desktop music player, built as an Electron + React app for macOS.
User uploads audio files (mp3/wav/flac/m4a/aac/ogg) from disk; Playdisc parses ID3-style
metadata (title/artist/duration/embedded artwork), stores everything in IndexedDB, and
plays it back with a custom-rendered, color-reactive waveform. It is explicitly **not**
a streaming platform — no catalog, no accounts, no backend. Local files only.

The user (Griffin) is iterating on this conversationally, screenshot by screenshot,
usually testing the **packaged app in `/Applications/Playdisc.app`**, not just the dev
build. He tracks his own backlog of requests/bugs in a macOS Reminders list; when he
pastes a screenshot of it, those are real asks to work through, not fluff.

## Stack

- **React 18** (function components, hooks, no external state library — all state
  lives in `App.jsx` and flows down via props)
- **Vite 5** for dev server / bundling
- **Electron 31**, packaged with **electron-builder**
- **wavesurfer.js 7** for waveform rendering/playback engine
- **music-metadata-browser** for ID3/atom tag + embedded artwork parsing
- **idb** (thin IndexedDB wrapper) for local persistence
- No TypeScript, no CSS framework — plain CSS in `src/styles.css` using CSS custom
  properties for theming

## Directory layout

```
playdisc/                # repo lives at ~/Developer/playdisc (was ~/Developer/sona, was ~/Downloads/music-player-app)
├── electron/
│   ├── main.js        # main process: window creation, mini-mode IPC handlers
│   └── preload.cjs     # contextBridge: exposes window.electronAPI (MUST stay .cjs)
├── src/
│   ├── App.jsx          # ALL app state and orchestration lives here
│   ├── main.jsx          # React entry point; Buffer polyfill lives here (critical, see below)
│   ├── styles.css        # single global stylesheet, CSS variables for theming
│   ├── components/
│   │   ├── PlaylistNav.jsx    # LEFT column of the library view: Imported item, playlist list (edit / pin / rename / delete via right-click), + new playlist, then QueuePanel + HistoryPanel, resize handle
│   │   ├── PlaylistEditModal.jsx  # centered modal: playlist name + optional description + optional cover image (picker or drag-drop)
│   │   ├── LibraryList.jsx    # MIDDLE column: header (title/count/time), list⇄grid toggle, search, tag filter, multi-select + bulk bar, track list or grid, drag-reorder (playlist views), track right-click menu
│   │   ├── QueuePanel.jsx     # "up next" panel w/ drag-reorder (was inline in old Sidebar)
│   │   ├── HistoryPanel.jsx   # "recently played" collapsible panel (was inline in old Sidebar)
│   │   ├── ContextMenu.jsx    # reusable right-click menu (controlled: App holds `contextMenu` state, renders one instance); supports one level of submenu
│   │   ├── TagMenu.jsx        # combobox popover for applying/removing tags (portal, position:fixed, flips up near the bottom); used by TrackItem's `+ tag` and the bulk bar's `+ tag` / `− tag`
│   │   ├── TrackItem.jsx      # one row in the track list
│   │   ├── UploadButton.jsx   # file picker
│   │   ├── NowPlaying.jsx     # RIGHT column of the library view (artwork + waveform + transport)
│   │   ├── FocusView.jsx      # fullscreen "focus mode" view
│   │   ├── MiniPlayer.jsx     # content shown when the OS window is shrunk to mini mode
│   │   ├── BackgroundPlayBar.jsx  # floating pill shown when browsing ≠ playing track
│   │   ├── Waveform.jsx       # owns the single WaveSurfer instance; heatmap + EQ bars
│   │   ├── WaveformSlot.jsx   # reparents the shared waveform DOM node into whichever view needs it
│   │   ├── SettingsModal.jsx  # theme toggle + keybinding editor
│   │   ├── SearchOverlay.jsx  # Option+Space quick-search palette — see "Quick search overlay" below
│   │   ├── VolumeIcon.jsx     # flat inline-SVG speaker glyph (no emoji)
│   │   ├── HeartIcon.jsx      # outline/filled heart (liked/favorites) — see activeView above
│   │   └── LibrarySetup.jsx   # blocking first-launch / recovery gate: choose library folder, or reset a legacy library
│   └── lib/
│       ├── db.js              # IndexedDB CRUD (idb wrapper)
│       ├── parseTrack.js      # File -> track record (metadata + artwork extraction)
│       ├── useObjectUrl.js    # hook: Blob -> object URL, auto-revoked
│       ├── keybindings.js     # DEFAULT_KEYBINDINGS, load/save/format helpers
│       ├── artworkTilt.js     # shared mouse-tilt handlers for album art
│       ├── likedBackdrop.js   # fixed (non-cover-derived) header gradient for the Liked view
│       ├── artistBackdrop.js  # per-artist header gradient, hashed from the artist's name
│       ├── media.js           # relPath contract (assertRelPath), mediaUrl, makeVersion, tag reading
│       ├── mediaFingerprint.js# size + edge-hash content fingerprint (import dedupe)
│       ├── syncSnapshot.js    # library <-> per-machine snapshot JSON + content-addressed art refs
│       └── syncMerge.js       # PURE per-item merge (newest wins, tombstones, per-note stamps) — tested
├── test/syncMerge.test.mjs   # `npm test` (node --test) — the only test suite in the repo
├── docs/LIBRARY_SYNC_PLAN.md # how sync was planned + staged (history; CLAUDE.md is current truth)
├── docs/deferred/crossfade.md # crossfade feature: scoped, shelved, not implemented — read before starting it
├── vite.config.js        # dev server port 5173; ignores release/ in the watcher
├── index.html             # <title>Playdisc</title>
└── package.json           # name: "playdisc", productName: "Playdisc"
```

## How to build / run

```bash
npm run electron:dev      # vite dev server + electron pointed at localhost:5173
npm run electron:build    # vite build + electron-builder -> release/mac-arm64/Playdisc.app
npm test                  # node --test test/ — the sync merge rules (pure, fast)
```

**Always fully restart** `electron:dev` (kill both processes, don't rely on HMR) after
touching anything in `electron/` (main.js, preload.cjs) — Electron's main process does
not hot-reload. Frontend-only changes (`src/**`) hot-reload fine via Vite, but if
several files changed or state feels stale, a fresh restart is cheap and safer than
debugging an HMR ghost.

### macOS code-signing gotcha (do this every rebuild)

electron-builder does **not** sign the app (no paid Apple Developer certificate
configured), which corrupts/omits the code signature enough that Gatekeeper shows
**"[App] will damage your computer"** — a hard block, not the milder "unidentified
developer" prompt. Fix every time after `electron:build`:

```bash
codesign --sign - --force --deep "release/mac-arm64/Playdisc.app"
```

This produces a valid ad-hoc signature (`Sealed Resources` present) that Gatekeeper
accepts for local execution. The user has established this workflow: rebuild → re-sign
→ quit the running app → replace `/Applications/Playdisc.app` → relaunch. He explicitly
asked me to do the `/Applications` replacement directly (not just hand him the file) —
that consent was scoped to this specific rebuild-and-replace loop for this app.

### Vite watcher gotcha

`release/` (electron-builder's output) sits inside the project root. Without
`server.watch.ignored: ['**/release/**']` in `vite.config.js`, Vite's dev server picks
up the packaged output as source changes and triggers spurious full-page reloads.
Already fixed — don't remove that config.

## Electron process architecture

- `electron/main.js`: creates a single `BrowserWindow`, `titleBarStyle: 'hiddenInset'`
  (traffic lights inset over content, no title-bar strip — this is why `.sidebar` and
  `.back-btn` have extra top padding, to clear the traffic-light hit area).
- `electron/preload.cjs`: **must stay `.cjs`**, not `.js`. `package.json` has
  `"type": "module"`, so a plain `.js` preload gets loaded as ESM and Electron's
  preload context throws `Cannot use import statement outside a module`. `.cjs`
  forces CommonJS regardless of the package type field. Preload uses
  `contextBridge.exposeInMainWorld('electronAPI', {...})` with `contextIsolation: true`,
  `nodeIntegration: false`.
- IPC bridge (`window.electronAPI`, see `preload.cjs` — every entry is commented
  there). Groups: **mini mode** (`enterMiniMode` / `exitMiniMode` / `onMiniHoverChange`),
  **source files** (`selectAudioImport` / `selectAudioFile` / `readAudioFile` — the
  ONLY calls that deal in absolute paths, of files picked in a native dialog),
  **media** (`mediaCopyIn` / `mediaExists` / `mediaDelete` / `mediaRename` /
  `revealLibraryDir` — all in `relPath`s), **library root** (`getLibraryRoot` /
  `chooseLibraryRoot`), **sync** (`syncListArt` / `syncWriteSnapshot` /
  `syncReadSnapshots` / `syncReadArt` / `syncDeleteOwnSnapshot` /
  `syncDeleteConflictedCopies`, plus the push channels `onSyncDirChanged` /
  `onLibraryFilesChanged`), and **app** (`appVersion`, `onOpenSettings`,
  `setModalOpen` / `onCloseActiveModal`, `onMediaKey`). For mini mode the main
  process remembers the pre-mini `getBounds()` in a module-level
  `boundsBeforeMini` variable and restores it on exit. Mini mode **really resizes the
  OS window** (`win.setBounds`, `win.setResizable(false)`, temporarily shrinks
  `setMinimumSize`) — it is not a fake widget floating inside the full-size window.
  This was a deliberate correction after the first mini-player implementation (an
  in-window widget) was explicitly rejected by the user as leaving "a huge big grey
  empty box."
- Console forwarding: `win.webContents.on('console-message', ...)` pipes all renderer
  `console.*` output to the terminal running `electron:dev`, regardless of whether
  DevTools is open. DevTools no longer auto-opens on launch (was previously
  `openDevTools()` unconditionally in dev — removed because the user didn't want it
  popping up every run). Open manually with Cmd+Option+I when needed; the console
  forwarding means you often don't need to.

## Library storage & sync

Shipped 2026-09-06 (branch `library-sync`, merge `c0d3d71`, tag
`library-sync-shipped`; `pre-sync-rework` marks main before it). Planned and staged
in `docs/LIBRARY_SYNC_PLAN.md` (history — this section is the current truth).
Tested at scale: 221 tracks incl. large WAVs imported on the laptop synced to the
desktop cleanly.

**The shape of it, in one paragraph.** Audio files live in ONE folder per machine,
the *library root*, which Griffin points at a folder inside Dropbox on each Mac (the
absolute path differs per machine and that's fine). IndexedDB holds the metadata
(tracks, playlists) exactly as before, but every version stores a path **relative to
the root**. Each machine also writes its whole library to a JSON snapshot in
`<root>/.playdisc/sync/<machineId>.json` (its own file, never anyone else's) with
cover art as content-addressed files in `<root>/.playdisc/art/`. Dropbox carries the
audio, the art, and the snapshots between machines. Each machine folds the *other*
machines' snapshots into its own library with a per-item newest-wins merge (tombstones
for deletes, per-note stamps so notes don't collide with other edits), triggered live
by a directory watcher plus focus/wake, and never while a text field has focus.
Nothing here is a server, an account, or a cloud API — it's files in a folder.

- **Library root + relative paths.** Audio files live under ONE per-machine
  folder, the *library root*, chosen in Settings › Library (or the first-launch
  gate) via a native folder picker and stored by main in
  `<userData>/config.json` (`{ libraryRoot, machineId }` — `machineId` is a
  generated UUID for the upcoming sync files). That root is the **only absolute
  path in the app**. Every version stores `relPath` (POSIX slashes, e.g.
  `"Artist — Title/title.wav"`), and every media IPC + the
  `playdisc-media://f/<encoded relPath>` protocol resolve it in main via
  `resolveRel()`, which throws on anything absolute, backslashed, `..`-y, or
  escaping the root. Renderer side, `assertRelPath()` in `src/lib/media.js` does
  the same check at every use (`mediaUrl`, `makeVersion`, rename/delete/relocate,
  the missing-file sweep). **A record with an old absolute `filePath` fails
  loudly, never silently** — that's the point of the rename, don't add fallbacks.
  App.jsx refuses to load a library containing any version without a valid
  `relPath` (`legacyLibrary`) and blocks behind `LibrarySetup.jsx` until "Reset
  library"; a missing/unset root blocks the same way until a folder is chosen.
  Only *source* files picked in a dialog (`selectAudioImport`, `selectAudioFile`,
  `readAudioFile`) are ever absolute. Import still **copies in** (adopt-in-place
  is a later stage).
- **Per-machine snapshots.** Each machine writes its whole library to
  `<root>/.playdisc/sync/<machineId>.json`, debounced 500 ms after any change to
  `tracks` / `playlists` / `tombstones` / `libraryOrder`(+`UpdatedAt`), serialized
  from the refs by `flushSnapshot` in `App.jsx` (writes are serialized; a change
  mid-write marks it dirty and it goes round again). Blobs never enter the JSON:
  `src/lib/syncSnapshot.js` turns `artworkBlob` / `originalArtworkBlob` / playlist
  `imageBlob` into `{ hash, ext }` refs to immutable
  `<root>/.playdisc/art/<sha256>.<ext>` files (written once, `wx` flag, only for
  names main doesn't already have — `knownArtRef`). The absent / `null` / blob
  tri-state of `originalArtworkBlob` is preserved exactly. Snapshot `format` is 2
  since stage 4 (tombstones inline in the arrays, `libraryOrderUpdatedAt`); format 1
  is still readable. Reset library also deletes this machine's own snapshot, so a
  reset doesn't resurrect from itself.
- **Merge rules.** `src/lib/syncMerge.js` is the pure merge —
  **no IPC, no React, tested by `npm test` (`test/syncMerge.test.mjs`, plain
  `node --test`; the repo has no other test setup). Change the rules there, add a
  case there.** Rules: every track/playlist carries `updatedAt`; **newest wins per
  item, whole record; a tie keeps the local copy** (strictly newer replaces). Deletes
  are tombstones `{ id, deleted: true, updatedAt }` in the same arrays (locally the
  `tombstones` state, `[{ id, kind, updatedAt }]` in `localStorage.syncTombstones`,
  never pruned); an edit newer than the delete resurrects. **Notes are the exception
  to whole-record**: they merge by note id with their own `note.updatedAt`, deletes
  go to `track.deletedNotes`, and note ORDER follows the side with the newer
  `track.notesUpdatedAt` — so a note edit here and a like there don't collide. That
  is why `patchTrack` stamps a notes-only change with `notesUpdatedAt` and everything
  else with `updatedAt`. Every local edit stamps `stampAfter(prev)` =
  `max(Date.now(), prev.updatedAt + 1)`, so an edit beats what it was based on even
  under clock skew. `libraryOrder` is one array with one stamp (`libraryOrderUpdatedAt`,
  bumped ONLY by a drag, never by the reconcile effect). The tag handlers now go
  through `patchTrack` (they used to call `updateTrack` directly and would have been
  unstamped).
  **Reading** (`runSync` in `App.jsx`): once at launch (`libraryPhase` `'sync'` →
  `'ready'`; this is also what fills an empty library, the old "bootstrap" is just a
  merge into nothing) and on every window `focus`, throttled to 1/s. Every OTHER
  machine's snapshot is folded in; the winners a remote produced are hydrated (art
  read from the art files) and applied through state **updaters**
  (`applyMergedRecords` re-checks each item against whatever the list is by then —
  an import landing mid-merge composes instead of being clobbered), and IndexedDB is
  written from the **committed** state by the drain effects next to
  `handleDeleteTrack` (full-record `replaceTrack`, never a partial `updateTrack`), so
  the database mirrors what React ended up with whichever side won. A remote record
  whose art file isn't on disk yet is **deferred whole** (`accept`), never taken with
  a null cover — that would stamp "no cover" as our newest truth and the art would
  never arrive. A remotely deleted track goes through `dropTrackRefs` (playing,
  browsed, zoomed, modals, queue, history) but its files are NOT touched — the
  deleting machine did that and Dropbox carries it over. A remote change to the
  playing track's active file restarts it from 0 (accepted, per the plan).
  **Pre-stage-4 records have no stamps.** The first stage-4 launch stamps them ONCE
  with this machine's own last snapshot `writtenAt` (never `Date.now()`, which would
  out-stamp every edit the other machine made since); a remote pre-stage-4 record
  reads with its snapshot's `writtenAt`. Either upgrade order converges. Don't
  "simplify" that to 0 — with 0-vs-0 ties going local, the other machine's edits
  would never arrive.
- **When a merge runs, and the edit guard (the file watcher).** `electron/main.js` keeps ONE recursive
  `fs.watch` on the library root (`startLibraryWatch`, FSEvents-backed, restarted on
  error and whenever the root is chosen). Events are debounced 400 ms and sorted into
  two renderer channels: `sync-dir-changed` for anything under `.playdisc/` (another
  machine's snapshot or an art file landing → `runSync`) and `library-files-changed`
  for everything else (audio arriving/moving → the missing-file sweep re-runs via
  `fileSweepTick`). It watches the DIRECTORY, never a file — Dropbox renames incoming
  content into place, so a file-level watch dies after the first update. Our own
  snapshot writes and `.tmp` files are skipped by name. `powerMonitor` `resume` and
  window `focus` are belt and braces on the same path. **A merge never applies while
  a text field is being edited** (`editInProgress()` in `App.jsx`, checked before the
  read AND right before apply): the merge is deferred. Fields where a landing merge is
  harmless opt out with `data-sync-passive` — library search, search overlay,
  Settings, and (2026-09-06) the **"add a note…" field while it is EMPTY**: the notes
  panel autofocuses it, and without that opt-out an open panel held every merge back
  ("notes don't update live"); with text in it, it counts as an edit again. A deferred
  merge resumes via `maybeResume` in the trigger effect, which listens to `focusout`,
  `keydown`, `mousedown` AND `input` (capture, re-checked after a tick) — NOT
  `focusout` alone: **Chromium fires no focusout/blur when the focused element is
  removed from the DOM** (verified live), which is what Escape-closing the notes panel
  or versions modal does to its autofocused input, so a focusout-only resume left
  merges stuck until some unrelated field blurred. That, not stamping, was the
  "checkbox doesn't sync" report — every note write path (`handleAddNote` /
  `ToggleNote` / `EditNote` / `DeleteNote` / `ToggleNotePriority`) stamps the note;
  reorder deliberately bumps only `notesUpdatedAt`. Absent audio splits into MISSING (this machine
  has seen the file before → relocate offered) and WAITING (never seen here → a
  remote track still on its way through Dropbox; "syncing…" state, no relocate) via
  `localStorage.seenRelPaths`. Dropbox "conflicted copy" snapshots are merged like any
  other and then deleted through `sync:delete-conflicted-copies`, only after a run
  with nothing deferred, and main refuses to delete anything not named like one.
- **Reset & recovery.** Settings › Library › "Reset library…" drops IndexedDB, the
  library-derived localStorage keys (`libraryOrder`, `libraryOrderUpdatedAt`,
  `syncTombstones`, `playHistory`, `seenRelPaths`) and **this machine's own snapshot**,
  keeps keybindings/theme/layout/volume, leaves audio files alone, and reloads. If
  another machine's snapshot exists the reload merges it in (that IS the
  "set up the second Mac" path); if none does, the library is empty and the audio
  files under the root are orphaned until re-imported (import copies in; there is no
  adopt-in-place yet — known gap, see below). A deleted snapshot is recoverable from
  Dropbox's own "Deleted files" for 30 days.
- **Known gaps, deliberately not built (yet):** adopt-in-place import (a file already
  under the root is copied again); cross-machine fingerprint dedupe (import from ONE
  machine at a time, or the same song gets two ids); art file GC (art files are never
  deleted); a drag-reorder in progress is not covered by the edit guard (a merge
  landing mid-drag can shift the list under the cursor).
- **Latency floor.** Our side is under a second (500 ms writer debounce + 400 ms watch
  debounce + a millisecond merge). The rest is Dropbox: typically 3–8 s machine to
  machine, 20–30 s when a big WAV shares its upload queue with the JSON. Don't chase
  that in our code.

## State architecture (`App.jsx`)

All state lives in `App.jsx`; components are close to pure props-in/callbacks-out.
No context, no external store. Key state and *why* it's shaped this way:

### `currentTrackId` vs `playingTrackId` — the most important distinction in the app

- `currentTrackId`: the track shown in the main panel (what the user is *browsing*).
- `playingTrackId`: the track actually loaded into the audio engine (what's *playing*).

These are deliberately decoupled. Single-clicking a track in the sidebar only changes
`currentTrackId` (pure browse, zero effect on playback). Double-clicking, pressing
play while browsing a different track, skip, and natural track-finish all go through
`handleAdoptAndPlay(id, { autoPlay })`, which sets both.

`audioUrl` (fed to the single `<Waveform>`) is derived from `playingTrackId`, **never**
`currentTrackId`. This is why browsing doesn't interrupt playback: the audio engine's
props never change just because you're looking at something else.

When `currentTrackId !== playingTrackId`:
- `NowPlaying`/`FocusView` show the browsed track's artwork/title, but overlay
  `"press play to switch playback to this track"` on top of the waveform area
  (`isCurrentlyPlayingTrack` prop) instead of showing a mismatched waveform.
- `BackgroundPlayBar` appears (bottom-center, or bottom-center-of-content-area when
  the sidebar is showing — see CSS section) showing the actually-playing track with
  its own mini play/pause and a small reactive pixel meter, so playback stays
  reachable without forcing navigation back to it.
- The play/pause icon shown to the user reflects `isPlaying && isViewingPlayingTrack`
  (a derived value), not raw `isPlaying` — so it always shows ▶ when you're looking at
  something that isn't currently sounding, even if something else is playing in the
  background.

### Single shared WaveSurfer instance — do not break this

There is exactly **one** `<Waveform>` React component instance for the whole app
lifetime, rendered via `createPortal(<Waveform .../>, waveformHostRef.current)` at the
top of `App.jsx`, where `waveformHostRef.current` is a plain detached `<div>` created
once (`useRef`, lazy-init) and never destroyed.

`NowPlaying`, `FocusView`, and `MiniPlayer` don't render their own `<Waveform>`.
Instead they render `<WaveformSlot host={waveformHost} />`, which on mount does
`containerRef.current.appendChild(host)` — physically moving the *same* DOM node
(containing WaveSurfer's canvases and its internal `<audio>` element) into whatever
layout currently wants to show it.

**Why:** WaveSurfer defaults to the `MediaElement` backend (an actual `<audio>` tag).
Browsers pause an `<audio>` element the instant it's removed from the document. Early
versions of this app conditionally rendered `<Waveform>` per-view (or conditionally
skipped `<WaveformSlot>` based on `isCurrentlyPlayingTrack`), which unmounted the slot,
detached the host node, and silently paused whatever was playing — this was reported
repeatedly as "playback stops/restarts when I switch views" and "clicking another
track pauses what's playing." Root-caused and fixed by:

1. Never conditionally unmounting `<WaveformSlot>`. It is *always* rendered in
   `NowPlaying`/`FocusView`/`MiniPlayer` (the latter renders it `display: none` — that's
   fine, `display: none` does **not** detach from the document, only `removeChild`
   does).
2. Using an absolutely-positioned CSS overlay (`.waveform-placeholder-overlay`,
   `pointer-events: none`, explicit `z-index: 10`, solid non-transparent background) to
   visually hide the waveform when not relevant, instead of removing it from the DOM.

**If you're asked to add a new view/surface that might show the waveform, or to hide
it under some condition, use the overlay pattern — never make `<WaveformSlot>`'s
presence conditional.**

> **History (2026-09-04, tag `waveformslot-fixed`): rule 1 had drifted, and was
> restored.** For a while the top-level view switch in `App.jsx` was a real ternary
> that mounted exactly one of `MiniPlayer`/`NowPlaying`/`FocusView`, each with its
> own `<WaveformSlot>`, so every `mini`/`sidebar`/`focus` transition did the exact
> `removeChild`-then-`appendChild` dance this section warns against. It mostly got
> away with it by timing: the reattach usually landed before the browser noticed.
> Diagnostics on the Cmd+,-from-mini path measured the failure precisely — host
> detached at t+0, reattached at t+14ms, and the `<audio>` element's own native
> `'pause'` fired at t+15.4ms, **after** reattachment, from `HTMLAudioElement`
> internals, not from any `pause()` call in our code. So it was a race, not a
> guarantee, and it would have caught any future feature that added work to a view
> transition. The mini-exit button and the `m` keybinding were only ever lucky.
>
> **What's true now (the `active` contract — load-bearing, easy to break):**
>
> - `NowPlaying`, `FocusView`, and `MiniPlayer` are **all rendered unconditionally**
>   in `App.jsx`, each with `active={view === '<theirs>'}`. The inactive two get the
>   `view-hidden` class (`display: none` in `styles.css`). They are **never** put
>   behind a conditional/ternary. `PlaylistNav`/`LibraryList` hold no audio and stay
>   conditional on `view === 'sidebar'`.
> - `WaveformSlot` takes `active` and claims the shared host node in a
>   `useLayoutEffect` whenever *it* becomes active — not on mount. Because both the
>   old and new containers are already in the document, the switch is a single
>   `appendChild` and the node is never detached. `useLayoutEffect` so the move lands
>   in the same commit as the switch, before paint.
> - `display: none` on an ancestor does **not** pause the media element; only
>   detachment does. (Proof in-tree: `MiniPlayer` always wrapped its slot in a
>   `display: none` div and played fine.)
> - DOM order in `App.jsx` matters: `.now-playing` has no explicit `grid-column` and
>   lands in column 3 by auto-placement after nav + list. Hidden views generate no
>   grid box (`display: none` / `position: fixed`), so the grid math is unchanged.
> - `useGradientDrift` takes `active` as a **real dependency** so a hidden view runs
>   *no* rAF loop and there is never more than one alive. `FocusView`/`MiniPlayer`
>   freeze the blob they feed the palette hooks while hidden (`heldBlobRef`), so a
>   hidden view never re-extracts a palette for a track it isn't showing and catches
>   up once on show. The `view-enter` mount animation on each view root replays on
>   `display: none` → shown, so the transition feel survived the change.
>
> **Adding a new waveform-bearing view:** render it always, give it `active`, pass
> `active` to its `<WaveformSlot>` (and to `useGradientDrift` if it drifts), and hide
> it with `view-hidden`. Never conditionally render it. Re-verification steps live in
> `docs/TESTING-waveformslot.md`.

### Library view = 3 columns (`view === 'sidebar'`)

The `'sidebar'` view (the name is now historical — it's the normal/general view)
renders a 3-column CSS grid on `.app`:
`[PlaylistNav | LibraryList | NowPlaying]`, widths `var(--nav-width)` (drag-resizable,
persisted to `localStorage.navWidth`) / `1fr` / `var(--np-width)` (fixed 278px).
**`'focus'` and `'mini'` views are untouched** — `.focus-view` still spans
`grid-column: 1 / -1`, `.mini-player` is still `position: fixed; inset: 0`.

- `activeView`: `{ type: 'imported' }`, `{ type: 'playlist', id }`, `{ type: 'liked' }`, or
  `{ type: 'artist', name }` — which left-nav item (or, for `'artist'`, which *ad hoc*
  page) the middle column shows. "Imported" = the **entire library** (newest-first), not
  "songs not in a playlist". Purely a view; never changes `currentTrackId`/`playingTrackId`.
- **Liked / favorites** (2026-09-05): `liked: boolean` + `likedAt: number|undefined` on
  the track record (see Track record shape below) — schemaless, no `DB_VERSION` bump,
  same as `originalArtist`/`originalArtworkBlob`. Toggled via `handleSetLiked(id,
  liked)` in `App.jsx` (`patchTrack` under the hood); `likedAt` is set on like and left
  alone on unlike (never cleared). `src/components/HeartIcon.jsx` is the outline/filled
  glyph used everywhere (track rows in both list and grid, the right-click Like/Unlike
  menu item) — its fill color is `var(--playing)`, the ONE place that color lives for
  the heart. Both the row heart and the context-menu item route through
  `LibraryList.jsx`'s existing `menuTargets(trackId)` helper, so acting on a row that's
  part of a multi-selection acts on the whole selection, same as tag/queue/delete.
  `{ type: 'liked' }` is its own `activeView`, a peer of Imported in the sidebar (its
  own zone above the "playlists" section label, NOT one of the playlist rows — it has
  no manual `trackIds` array, no rename/pin/delete). Its header uses a fixed,
  non-cover-derived gradient (`src/lib/likedBackdrop.js`, exports `likedBackdropStyle()`
  — several blue tones over a dark base, same visual construction as
  `meshBackdropStyle`'s palette branch but with hardcoded colors; `meshBackdropStyle`/
  `dominantColor.js`/the real extraction pipeline are untouched by this feature). Sort
  options: `'likedAt'` (this view's own default, "Recently liked" = desc) plus the
  normal `added`/`artist` options, but deliberately **no** `'custom'` — Liked isn't
  backed by a manual order to hand-drag. Everywhere else (Imported, playlists), sort
  gained a `'liked'` option ("Liked first") that groups liked tracks to the top, ties
  falling back to `dateAdded desc` (same secondary order `'artist'` sort already uses).
  Both new sort modes live in `src/lib/librarySort.js`. The Liked view's own row
  membership is a **snapshot** (`likedViewIds` state in `App.jsx`), re-taken on entering
  the view and on an actual sort change — NOT a live filter — so unliking a track while
  looking at this view leaves its row in place (the heart still flips to outlined
  immediately, reading live off `tracks`) until you navigate away or change sort; a
  misclick shouldn't make the row vanish. Playback/shuffle/skip all treat `{type:
  'liked'}` as a third case alongside `'playlist'`/`'library'` throughout `App.jsx`
  (`contextFromActiveView`, `orderedContextTracks`, `handlePlayLiked`, the header
  play/pause button) — shuffle is deliberately NOT liked-weighted, it stays unbiased.
- **Artist pages** (2026-09-06): `{ type: 'artist', name }` — a fourth `activeView` case,
  threaded through `App.jsx` exactly the way `'liked'` was added as a third one
  (`shownTracks`, `activeSort`/`activeSortDir` via their own `artistSort`/`artistSortDir`
  state, `contextFromActiveView`, `orderedContextTracks`, `handlePlayArtist` alongside
  `handlePlayLiked`, `headerViewPlaying`, `handleHeaderPlayPause`) — playback, shuffle,
  and skip all treat it as a real context, not a filtered view of another one. Unlike
  Liked, membership is a **live filter** (`tracks.filter(t => primaryArtist(t.artist) === name)`),
  not a snapshot — a track's artist only ever changes via the deliberate rename flow in
  `VersionsModal`, not a quick misclick, so there's no vanishing-row concern to guard
  against. No sidebar entry — it's not one of the left-nav zones, just a page you land on
  (see "getting there/back" below).
  - **Featured-artist grouping** (2026-09-06): `src/lib/artistName.js`'s `primaryArtist()`
    is the ONE place that decides which artist page a track belongs to — it splits ONLY
    on a word-bounded `feat`/`feat.`/`ft`/`ft.` (case-insensitive), so "Daft Punk feat.
    Todd Edwards" groups under the existing "Daft Punk" page instead of spawning its own.
    `&`, `with`, `x`, and `,` are deliberately NOT treated as separators, checked against
    the real library first rather than assumed: "Bob Marley & The Wailers" is a band's
    actual name, and splitting on `&` would have broken it into "Bob Marley" plus a
    dangling "The Wailers". `x` is a real separator Griffin's own bounces use ("Griffin x
    Marley Chaney") but none are imported yet, so there's nothing to verify the parsing
    against — add it (and re-check the real library the same way first) once there is.
    `primaryArtist()` is ONLY for grouping/navigation (`openArtist`, the artist-view
    membership filter, `handlePlayArtist`, `orderedContextTracks`'s artist branch, and
    `SearchOverlay`'s artist-result dedup) — every actual DISPLAY of an artist string
    (track rows, grid tiles, Now Playing, Focus view, search subtitles) stays the full,
    literal `track.artist` value untouched.
  - **Header**: reuses `LibraryList` itself (a new `isArtistView` branch alongside
    `isLikedView`/`isPlaylistView`, not a separate component) so every per-row
    interaction — select, play, tag, queue, like, delete, right-click menu — comes for
    free and nothing about the existing views' code paths changed. `isFullHeader` is
    unconditionally true for it (same as Liked — no "compact" state ever applies). The
    gradient is `src/lib/artistBackdrop.js`'s `artistBackdropStyle(name)`: the artist's
    name is HASHED (djb2) to a hue 0–359 — never randomized, so the same artist always
    lands on the same hue and different artists visibly differ — then rendered as a fixed
    monochromatic ramp of tones at that hue over a dark base, the same "radial blobs over
    a dark base" construction as `likedBackdropStyle()`. Retune the look at
    `ARTIST_GRADIENT_BASE_S`/`ARTIST_GRADIENT_BASE_L`/`ARTIST_GRADIENT_TONES` in that file
    only; `meshBackdropStyle`/`dominantColor.js`/the real extraction pipeline are
    untouched, same rule `likedBackdrop.js` follows. Sort options are the same set as a
    playlist view minus `'custom'` (no manual `trackIds` array to hand-drag, same reason
    Liked has none either); default is `'added'`/desc, not `'artist'` — every row here
    already shares this page's own artist, so that mode would just degrade to a plain
    title sort as the first thing you see.
  - **Getting there**: click an artist name anywhere it appears —
    `TrackItem.jsx`'s `.track-artist`, `LibraryList.jsx`'s `GridItem`'s `.grid-artist`,
    `NowPlaying.jsx`'s `.np-artist`, `FocusView.jsx`'s `.focus-artist` — each wired to
    `onOpenArtist` (ultimately `App.jsx`'s `openArtist(name)`). The row-based ones
    `stopPropagation()` on both click and dblclick so opening the artist page never also
    selects or plays that row. The quick search overlay's artist results (see below) and
    "Imported"/"Liked Songs" Views results reuse this same path.
  - **Getting back**: Escape only — no dedicated back button (one was built, then
    explicitly dropped: "Escape already returns me to the previous view and that's
    enough," not worth the UI weight). Checked in `App.jsx`'s global keydown effect right
    after the existing fullscreen/mini-exit check (`if (e.key === 'Escape' &&
    activeView.type === 'artist')`), so it loses to Settings/the search overlay (each
    owns Escape entirely while open) and to `LibraryList`'s own search-box Escape
    handling (local, stops propagation) exactly the way every other Escape consumer in
    this app already nests. `App.jsx`'s `artistPageReturn` state captures the exact
    `{ view, activeView }` present the moment the page was first opened — chained
    artist → artist navigation (e.g. via search) does not overwrite that captured point,
    so it always unwinds to wherever you actually started — and a small safety-net effect
    clears it whenever `activeView.type !== 'artist'`, so navigating away directly via the
    sidebar (which bypasses this Escape path entirely) can't leave it stale for the next
    visit. **Scroll position is deliberately NOT restored** — every other view switch in
    this app already resets scroll to the top by design (`LibraryList`'s `listKey`
    effect), so there's no existing "remember where I was" mechanism to hook into; adding
    one only for this exit path would be new, inconsistent behavior, not a restoration of
    something that already existed.
- `playlists`: array of `{ id, name, trackIds: string[], pinned, sortIndex, createdAt, updatedAt }`.
  Left-nav order = `pinned desc, sortIndex asc` (`sortIndex` backfills to `createdAt`
  for old records). Drag-reorder in `PlaylistNav` (`handleReorderPlaylists`) renumbers
  the dragged item's group (pinned vs unpinned) by 1000s; you can't drag across that
  boundary.
  A playlist is just an **ordered list of track ids** — deleting one never touches the
  tracks. Stored in a new IndexedDB store `playlists` (**DB_VERSION bumped 1→2**; the
  `upgrade` callback is now `oldVersion`-guarded so existing v1 dbs migrate cleanly).
  Every mutation writes the whole record through via `persistPlaylist` /
  `putPlaylist`. `handleDeleteTrack` also prunes the id from every playlist.
- `libraryViewMode`: `'list' | 'grid'`, persisted to `localStorage.libraryViewMode`.
  Toggled by the `toggleLibraryView` keybinding (default `v`) as well as the header
  buttons.
- `npWidth`: right now-playing column width. **`null` = responsive** — auto width
  `max(320, min(1400, round((viewportW - navWidth) * 0.483), avail - 340))`, i.e. the
  right/artwork column and the middle track list split the post-nav space roughly
  evenly (measured to match a screenshot the user signed off on). Becomes a number
  once the user drags the left-edge handle (`.np-resize-handle`), persisted to
  `localStorage.npWidth`. A window-`resize` listener updates `viewportW` and re-clamps
  the pinned widths so the middle track list always keeps ≥300px. `navWidth` default
  is 236. When `navCollapsed` (Tab), `--np-width` is `viewportW / 2` — the track list
  and artwork split the whole window evenly, and `--nav-width` is 0; toggling Tab off
  returns to the responsive value because nothing mutates `npWidth` while collapsed
  (both resize handles are `display:none` then — a live np handle sits mid-window and
  is trivially grabbed by accident, which is exactly how a bad width once got saved).
  There is a **one-time layout reset** at the top of `App.jsx` keyed on
  `localStorage.layoutDefaults` (currently `'v2.4'`): on first run of a new value it
  clears saved `npWidth`/`navWidth` so a stale hand-dragged width can't override a
  re-tuned default. Bump that string whenever the defaults are re-tuned. The
  now-playing + focus artwork/waveform are sized off viewport units so both views
  scale with the window. **Mini mode is fixed-size and unaffected**. Window opens at ~Raycast "Almost Maximize" (work area inset ~3%,
  centered — see `electron/main.js`).
  - `--nav-width` / `--np-width` are **registered via `@property`** (`<length>`) so the
    grid can transition — that's what makes the Tab collapse *slide*. App.jsx feeds
    them **clean px only**; a `vw`/`clamp()` value silently fails registered-property
    validation and the var freezes at `initial-value`. `.app.resizing` kills the
    transition so a drag-resize still tracks 1:1. NOTE: CSS transitions are frozen
    while `document.hidden` — the in-app browser pane is always hidden, so verify
    Tab-slide smoothness in the packaged app, not the dev preview.
- `navCollapsed`: `Tab` (the `toggleNav` keybinding) slides `PlaylistNav` out of view
  in the `'sidebar'` view — grid's `--nav-width` animates to 0 + `.playlist-nav`
  `translateX(-100%)`. `.app.nav-collapsed .library-list` gets extra left padding to
  clear the traffic lights.
- **`window.prompt()` does NOT work in Electron** (throws "not supported"). Anything
  needing a typed string (naming a new playlist) uses `<PromptModal>`, controlled by
  App's `promptConfig` state. `window.confirm()` *is* fine and is still used for
  destructive confirms.
- **Playlist edit** (`PlaylistEditModal.jsx`, App `editingPlaylistId` state): right-
  click a playlist → "Edit…" (Rename stays too). Modal edits name + optional
  `description` + optional `imageBlob` (both new playlist-record fields, no DB
  migration — records are schemaless). Image is downscaled to ≤600px by
  `src/lib/imageResize.js` on pick/drop, stored as a Blob. When the active playlist
  has an image and/or description, `LibraryList` swaps its plain `.lib-header` for a
  `.playlist-hero` band (96px cover + name + 2-line-clamped description + count +
  quick "edit" button); with neither, the header is unchanged. Modal backdrop uses
  `.modal-overlay-blur` (a ~3px `backdrop-filter` on top of the shared scrim). The
  cover box also accepts drag-and-drop; the overlay `preventDefault`s stray drops so
  Electron doesn't navigate to the file.
- `playbackContext`: `{ type: 'library' }` or `{ type: 'playlist', id }`. Set whenever
  a NEW playing track is chosen from the middle column (`handlePlayTrack`,
  `handleTogglePlay` adopting a browsed track, `handlePlayPlaylist`) — derived from
  `activeView` at that moment. `handleSkip` / `handleFinish` traverse
  `orderedContextTracks()` (the playlist's manual order, else library newest-first)
  instead of always library order. This is what makes "next" stay inside a playlist.
- `contextMenu`: `{ x, y, items }` for the single `<ContextMenu>`. `setContextMenu` is
  passed to PlaylistNav (playlist right-click) and LibraryList (track right-click,
  which acts on the whole multi-selection if the clicked row is part of one).
- **Multi-select** (tracks in list *and* grid, and playlists) all goes through
  `src/lib/useListSelection.js`. ⌘/ctrl-drag paints a **range** (anchor → row under
  cursor, rebuilt on every `onMouseOver` + an `elementFromPoint` backstop) so a fast
  drag never skips rows; shift-click extends; plain click clears. Rows carry
  `data-sel-id`. Playlists: Delete/Backspace or right-click "Delete N playlists"
  removes the selection (songs stay in the library). **Press feedback on rows is a
  `filter: brightness()` dip, NOT a `transform: scale()`** — a scale-down shrinks the
  row out from under the cursor and the click lands on empty space (this was the
  "clicks feel inconsistent" bug). Buttons keep the scale-down.
- **Tags** (`TagMenu.jsx`): `+ tag` on a row opens a combobox popover pre-populated
  with every existing tag (`allTags`, computed in `LibraryList` from the current
  view's tracks) — no typing needed; typing narrows, and a non-matching query gets a
  "Create …" row. Picking a tag keeps the menu open (tag several at once); Esc / click
  / scroll closes. Rendered in a portal with `position: fixed` so the scrolling list
  never clips it, and it flips above the button when there's < 240px below. If the
  clicked row is part of a multi-selection, the pick fans out to the whole selection
  (`LibraryList.handleRowAddTag` → `menuTargets`) and the menu shows an "adding to N
  songs" note. The bulk bar has `+ tag` (same menu, `allTags`) and `− tag` (only shown
  when the selection has tags; options = union of tags across selected tracks, removes
  from all). The old inline `<input>`/`window.prompt`-style tag entry is gone.

### Other App.jsx state

- `view`: `'sidebar' | 'focus' | 'mini'` — which top-level layout shows. `'sidebar'`
  is the 3-column library view (see above); it and FocusView are mutually exclusive
  (conditional render, safe because neither owns the waveform DOM node directly —
  `WaveformSlot` re-mounts into whichever is active and reparents the persistent host).
  Mini uses the same pattern via its own `<WaveformSlot>` (hidden).
- `isPlaying`, `currentTime`, `duration`: engine playback state, driven by WaveSurfer
  events (`play`/`pause`/`audioprocess`/`ready`).
  - `currentTime` updates are **throttled to 200ms** via `handleTimeUpdate` in
    `App.jsx` (a `performance.now()`-gated wrapper around `setCurrentTime`). Raw
    `audioprocess` events fire many times a second; without throttling, the entire app
    re-rendered constantly during playback, which manifested as generally "laggy,
    buggy, sometimes needs two clicks" — do not remove this throttle or lower it much
    below 200ms.
- `queue`: array of track IDs, a manually-built play queue. Consumed first (shift off
  the front) by both `handleSkip(1)` and `handleFinish` before falling back to
  library-order traversal. Not persisted across restarts (in-memory only).
- `history` / `historyIndex`: browser-style play-history back/forward stack. Every
  genuinely-new track that starts playing is appended (`{ hid, trackId, playedAt }`);
  `historyIndex` points at the currently-playing entry. `handleSkip(-1)` walks back
  through it, `handleSkip(1)` retraces forward before falling to queue/shuffle/library;
  playing something brand-new while stepped back truncates the forward tail. Persisted
  to `localStorage` (`playHistory`); `historyIndex` always re-inits to the live edge
  (`history.length`) on load. Shown in Sidebar's collapsible "recently played" panel.
  **All history mutations go through `commitHistory(list, pos)` / `setHistoryPos(pos)`
  which set plain values and keep `historyRef`/`historyIndexRef` in lockstep — never a
  `setHistory(prev => …)` updater with ref/setState side effects inside, because
  StrictMode double-invokes updaters and that double-applied the index math (dev-only
  bug: forward tail wasn't truncated on a new play).**
- `navWidth`: width of the left playlist-nav column, persisted to
  `localStorage.navWidth`, applied via CSS var `--nav-width` on `.app` (clamped
  170–340). Drag-resize handled by a `mousemove`/`mouseup` listener pair gated by
  `isResizingSidebarRef`, started via `.sidebar-resize-handle`'s `onMouseDown` (the
  handle lives on PlaylistNav's right edge).
- `volume`: persisted to `localStorage`. Applied via `volumeRef` (not just state)
  because **each track switch recreates the WaveSurfer instance** (see below), which
  resets volume to its default — `handleReady` re-applies `volumeRef.current` on every
  new track load.
- `keybindings`: loaded/saved via `src/lib/keybindings.js`, editable in
  `SettingsModal`. Next/prev track (`handleSkip(±1)`) are bound to the arrow
  keys only — `next`/`prev`'s own default key, no separate alt action. `d`/`u`
  are `scrollDownFast`/`scrollUpFast` (fast library scroll, same
  `nudgeLibraryScroll` mechanism as `j`/`k`, ~half a viewport per press).
  (There used to be a second `nextAlt`/`prevAlt` action pair so the arrows
  could double as next/prev alongside `d`/`u`'s primary binding — removed
  when `d`/`u` were repointed to fast-scroll, since the alt actions were then
  fully redundant with `next`/`prev` itself. `loadKeybindings()` runs a
  one-time versioned migration, `migrateKeybindings()`, for installs with a
  saved `d`/`u` next/prev override or a customized `nextAlt`/`prevAlt` from
  before this change.) **`playPause`'s keyboard handling is the one exception** to
  "the big dispatcher reads `keybindings.<action>.key`" — it moved out into its own
  keydown/keyup effect for the hold-for-2x feature (2026-09-06, see "Audio / playback
  / visualization system" → "Hold space for 2x"), since tap-vs-hold can't be decided
  in a plain keydown-fires-immediately branch. It still reads `keybindings.playPause.key`
  to know which key it owns — rebinding play/pause moves the hold gesture with it.
- `theme`: `'dark' | 'light'`, persisted to `localStorage`, applied as
  `document.documentElement.dataset.theme`.
- `expandedTrackId`: which track row is "zoomed" (Z key / `expandTrack`),
  Cubase-track-height style, list view only. **Z is the only thing in the whole
  app that ever scrolls the library list** — nothing auto-repositions it on a
  track change, a skip, or playback starting; that was tried (an effect
  following `currentTrackId`) and it fought the user's own scrolling badly
  enough to make the list unusable. `handleExpandTrack` in `App.jsx` does the
  scroll itself, synchronously, with a direct DOM query + `scrollIntoView`
  (same pattern as `nudgeLibraryScroll`) — not a React effect keyed on state,
  so there's no timing window for something else to fight it.
  - Target: `playingTrackId` if a track is loaded, else the browsed
    `currentTrackId`.
  - Pressing Z **always** centers the target, in both list and grid — this is
    unconditional, checked first, before any expand/collapse decision.
  - Expand/collapse (list view only; grid has no info panel and never touches
    `expandedTrackId`) only toggles OFF when the target is already expanded
    **and fully visible**. If it's expanded but scrolled out of view, Z
    re-centers it and leaves it expanded — it does not collapse. This
    distinction matters: an earlier version toggled unconditionally, so a Z
    press while scrolled away would sometimes silently collapse (no scroll at
    all) instead of bringing the track back, alternating between "jumps" and
    "does nothing" depending on parity.
  - The zoomed row shows an info strip (a quality badge + chips from
    `src/lib/audioQuality.js` — codec / sample rate / bit depth or bitrate —
    then size, date added, duration, tag count; `.track-expanded-info` in
    `TrackItem.jsx`). This depth is **only** in the zoom — the user explicitly
    wanted the right-hand NowPlaying column kept to just title + artist.
  - **The centering scroll must stay instant** (`scrollIntoView({ block:
    'center' })`, no `behavior: 'smooth'`) — a smooth scroll re-targets
    against the row's own growing height (list view) and hard-froze the
    renderer on rapid track changes.

### Quick search overlay (`Option+Space`) (2026-09-06)

`src/components/SearchOverlay.jsx`, a floating Raycast/Spotlight-style command
palette over whatever view is showing, without touching that view. Purely a
finding tool — selecting a result navigates to it, it never plays anything.
Controlled by `searchOverlayOpen` state in `App.jsx` (conditionally rendered,
same as `SettingsModal`/the other modals — not always-mounted, since it holds
no audio and needs no `WaveformSlot`-style persistence).

- **Trigger — `Option+Space`, fixed and NOT in `DEFAULT_KEYBINDINGS`.**
  Checked as `e.altKey && e.code === 'Space'` in `App.jsx`'s existing global
  keydown effect — deliberately a plain renderer `keydown`, not Electron's
  `globalShortcut` (system-wide, and already the source of real conflicts
  elsewhere via the F7/F8/F9 media-key handling), so it only ever fires while
  the window is actually focused, for free. `e.code` (not `e.key`) because
  macOS's Option-composes-a-character behavior can otherwise turn `e.key` for
  Space into something other than a plain space. Fixed/non-rebindable is the
  same precedent as Cmd+W and Cmd+, below — `eventToKeyString()` in
  `keybindings.js` has no concept of Alt as a modifier at all today, so making
  this a real rebindable action would mean extending that first, not just
  adding a `DEFAULT_KEYBINDINGS` entry.
- **Dismissal (Escape / Cmd+W / click-outside) slots into the existing Cmd+W
  pattern instead of a fourth mechanism.** `SearchOverlay` owns its own
  capture-phase `document` keydown listener, same shape as
  `SettingsModal.jsx`'s: it handles Escape/Cmd+W itself and calls
  `stopPropagation()` on dismiss. `App.jsx`'s bubble-phase global handler has
  `if (settingsOpen || searchOverlayOpen) return;` at the very top — identical
  to how it already deferred entirely to Settings. **The two listeners never
  inspect each other's state; they coordinate purely through
  `stopPropagation`.** (This is the fix for the earlier Settings/Cmd+W bug —
  see git history around `3b5c809`/`c71036b` — where a capture-phase handler
  that skipped `stopPropagation()` let Cmd+W fall through and close the
  window on the same keypress. Any new modal-ish overlay should copy this
  shape, not invent a fifth mechanism.)
- **Results**: tracks (title/artist), a **Views** group, and artists. Views
  merges playlists (name) with two synthetic entries, Imported and Liked
  Songs (2026-09-06) — same "thing you navigate to" as a playlist, just not
  user-created, which is also why the group is labeled "Views" and not
  "Playlists" (stopped fitting once it held two things that aren't
  playlists). There's no artist entity in the data model, so the artist list
  is built on the fly in `SearchOverlay.jsx` as the distinct,
  case-insensitively deduped set of non-empty `track.artist` values
  (first-seen casing kept, with a track count). Each group is capped
  independently at 8 (`RESULTS_PER_GROUP`), not one global cap — otherwise a
  broad query could let tracks (there are far more of them than playlists or
  artists) crowd out the other groups entirely. Grouped under muted
  uppercase section headers rather than a per-row type badge, matching
  `PlaylistNav`'s `.nav-section-label` look — see `groupOf()` in
  `SearchOverlay.jsx` for the result-type -> group-label mapping (Imported
  and Liked Songs have their own dispatch `type`s, `'imported'`/`'liked'`,
  distinct from `'playlist'`, but share its group). Within Views only,
  results are ranked by match strength (`matchRank()`: exact match, then
  prefix, then plain substring) rather than left in filter order — so typing
  "liked" surfaces Liked Songs ahead of some playlist that merely contains
  those letters. Tracks and artists don't get this ranking; a short fragment
  of a longer title/name is the normal way to search those, so "contains" is
  already the expected match, not a weak one.
- **Selecting a track** goes through `landOnTrack(id)` in `App.jsx`, which
  generalizes `handleExpandTrack`'s already-existing deferred-scroll
  mechanism (`pendingScrollTargetRef` + `scrollRequestTick`, see "Other
  App.jsx state" → `expandedTrackId` above) to an arbitrary id instead of
  always `playingTrackId || currentTrackId`, preceded by a view switch when
  needed. Lands exactly like pressing `z` on it: browsed + expanded (list
  view only) + centered. **Which view it lands in**: stays in the current
  `activeView` if that view already contains the track (avoids an
  unnecessary context switch when it's already visible right there);
  otherwise goes to `{ type: 'imported' }`, since Imported always contains
  every track by definition (see `activeView` above) — there's no need to
  rank among multiple playlists that might also contain it.
- **Selecting an artist** goes through `openArtist(name)` in `App.jsx` — this
  was originally a placeholder (`{ type: 'imported' }` +
  `setLibrarySearchQuery(name)`, "there's no artist page yet") and, as
  planned, only `openArtist`'s own body changed once real artist pages
  shipped (see "Artist pages" under "Library view = 3 columns" above) —
  `handleSelectSearchResult`'s dispatch (`track` → `landOnTrack`, `playlist`
  → `setActiveView`, `artist` → `openArtist`) never needed to change.
  Selecting Imported or Liked Songs from the Views group goes through the
  same `handleSelectSearchResult`, with two more branches
  (`result.type === 'imported'`/`'liked'`) that just `setActiveView`
  directly, same as a playlist result does.
- **Keyboard**: arrows navigate, Enter selects the highlighted result
  (highlighted defaults to index 0, reset on every query change so Enter
  works immediately after typing), Cmd+1–9 jump straight to results 1–9.
  Typing filters live via a plain `useMemo` over `tracks`/`playlists` — no
  submit step, no debounce (the library is small enough that it doesn't
  need one).

### Track record shape (see `src/lib/db.js`)

```js
{
  id: string,            // crypto.randomUUID()
  title: string,
  artist: string,
  duration: number,      // seconds
  activeVersionId: string,
  versions: [            // >= 1; the audio itself lives on disk under the library root,
    { id, title, originalTitle, relPath, duration, format, fingerprint, dateAdded }
  ],                     //   relPath is RELATIVE to the root — see "Library storage & sync"
  notes: [ { id, text, complete, priority, dateAdded, updatedAt } ],
  artworkBlob: Blob|null,// cover art (embedded at import, or edited); never in the snapshot JSON
  audio: {              // fidelity info from music-metadata (null on parse fail,
    codec, sampleRate,  //   and absent on records imported before 2026-08-27)
    bitrate, bitsPerSample, channels, lossless
  } | null,
  tags: string[],
  dateAdded: number,     // epoch ms; sort key for library order
  liked: boolean,        // schemaless, 2026-09-05 — absent on older records reads as
                          //   not-liked, no backfill/migration. See activeView above.
  likedAt: number|undefined, // epoch ms, set on like; left as-is (not cleared) on unlike
  updatedAt: number,     // sync stamp (stage 4) — see "Sync merge" above
  notesUpdatedAt: number,    // sync stamp for note ORDER only
  deletedNotes: [{ id, updatedAt }] // note tombstones; `notes` holds only live notes
}
```

This isn't an exhaustive list of every field on a track record — schemaless additions
(`liked`/`likedAt` above, `originalArtist`, `originalArtworkBlob`) get merged in via
`patchTrack`/`updateTrack` without necessarily being added here. Treat this as "the
shape as of the last time someone updated this comment," not a strict schema.

IndexedDB database name is `"my-music-player"` (stores `"tracks"` and, since
DB_VERSION 2, `"playlists"`) — **not** renamed when the app was rebranded (twice now:
`my music player` → `Sona` → `Playdisc`).
Harmless (it's an internal identifier the user never sees), but don't be surprised
finding it while debugging storage, and don't
"fix" it without checking whether a migration is worth the churn — a rename would
require a migration path or it just creates a second empty database.

## Audio / playback / visualization system

All of this lives in `src/components/Waveform.jsx`.

- **Backend**: WaveSurfer's default `MediaElement` backend (uses a real `<audio>` tag
  internally) — not `WebAudio`. This is *why* the DOM-detachment-pauses-playback issue
  above is real and must be respected.
- **Playback fidelity**: the `<audio>` element plays the imported file's original
  bytes — Playdisc never transcodes (`parseTrack` stores `audioBlob: file` untouched). So
  playback quality == whatever was imported; a lossless import (FLAC/ALAC/WAV) really
  is lossless out, which is the answer to "better than Spotify" (Spotify tops out at
  320 kbps lossy). The decoded data grabbed on `ready` is only for the visualizer, not
  playback. Don't add a normalize / gain / resample stage without a very good reason.
- **Custom `renderFunction`** (`renderHeatmapBars`): draws every waveform bar's color
  from its *own* amplitude, via a `colorFn(amplitude)` held in `colorFnRef`. Default
  is `amplitudeColor` — quiet bars cool (teal/green), loud bars hot (red/orange), HSL
  hue 150→0. When the **playing** track has cover art, App feeds a `palette` prop
  (`useArtworkPalette` on `playingTrack.artworkBlob`, same sampler as the fullscreen
  backdrop) and `colorFnRef` is swapped for `makeAmplitudeScale(palette.colors)` — the
  cover's colors ordered dark→bright and interpolated in RGB across amplitude, so the
  waveform + EQ strip + scrub cursor take on the cover's colors. No artwork → stays on
  the default heatmap. The EQ loop reads `colorFnRef` live; the already-painted
  waveform canvas is repainted by re-setting `renderFunction` via `ws.setOptions`.
  This bypasses WaveSurfer's built-in `normalize` step, so the function does its own
  peak-scan normalization against the track's own max.
- **Progress/"played" region**: WaveSurfer always re-tints the played region with a
  single flat `progressColor` on a second canvas layered on top of the (always fully
  rendered) base heatmap canvas. This cannot be made to preserve per-bar heatmap
  colors — it's an all-or-nothing recolor by design in wavesurfer.js. Current setting:
  a **theme-aware translucent wash**, computed at creation time from
  `document.documentElement.dataset.theme`:
  - dark: `rgba(255,255,255,0.3)`
  - light: `rgba(0,0,0,0.5)` (needs more contrast against a near-white surface)
  History: started as an opaque white/pink wash (user: "don't like the pink overlay,
  changes color when I scrub") → made fully transparent (user: "now I can't see what's
  played, blends into the background") → landed on the current theme-aware translucent
  version. If touching this again, keep both failure modes in mind — too strong reads
  as "changing color"/jarring, too weak reads as invisible.
- **Pixel-art equalizer strip** (`.waveform-eq`, `EQ_BAR_COUNT = 24`): a *second*,
  independent live visualizer below the waveform, **not** part of the WaveSurfer
  canvas. Driven by its own `requestAnimationFrame` loop (`startEqualizerLoop`),
  throttled to `EQ_UPDATE_INTERVAL_MS = 90` for a deliberately chunky/stepped look
  (not smooth interpolation — that's the point, "pixel art" was explicitly requested
  after a smoother whole-container pulse was tried and called "barely visible"/too
  subtle). Samples a window of the decoded channel data around the current playhead,
  split into per-bar sub-bands, direct DOM style mutation via `eqBarRefs` (no React
  re-render). Started/stopped on WaveSurfer's `play`/`pause` events.
- **Decoded audio access**: on `ready`, grabs `ws.getDecodedData().getChannelData(0)`
  once into `decodedChannelRef`, plus `sampleRateRef` and a scanned `trackPeakRef`
  (max abs sample, used for normalization everywhere in this file). All the reactive
  visual bits (EQ loop, `getAmplitude()`) read from these refs rather than re-decoding.
- **Imperative handle** (via `forwardRef`/`useImperativeHandle`): `play`, `pause`,
  `toggle`, `isPlaying`, `seekTo(fraction)`, `skip(seconds)`, `setVolume`, `getVolume`,
  `getCurrentTime`, `getDuration`, `setPlaybackRate(rate, preservePitch)` (2026-09-06 —
  see "Hold space for 2x" below), and `getAmplitude()` (single 0..1 loudness reading
  at the current playhead — used by `BackgroundPlayBar`'s mini meter, not just the
  main EQ).
- **Hold space for 2x, tape-style** (2026-09-06): `setPlaybackRate` forwards straight
  to wavesurfer's own `setPlaybackRate(rate, preservePitch)`, which sets the underlying
  `<audio>` element's `playbackRate`/`preservesPitch` directly (see
  `node_modules/wavesurfer.js/dist/player.js`) — the **unprefixed, standard** property.
  Confirmed live in this Electron 31.7.7 renderer, not assumed:
  `'preservesPitch' in HTMLMediaElement.prototype` is `true`;
  `webkitPreservesPitch`/`mozPreservesPitch` are both `false`, not present — no
  vendor-prefixed fallback needed on this Chromium version. `preservePitch: false` is
  what makes pitch rise with speed (the tape/record effect); `true` is the normal
  browser default, used to reset back to 1x. Playhead tracking needed no extra work —
  `playbackRate` is a native `<audio>` property, so `currentTime` already advances
  correctly at 2x, and everything reading it (the progress bar, the EQ/frequency-band
  sampling above) just follows along; nothing here is 2x-aware.

  The tap-vs-hold detection lives in `App.jsx`, not here: play/pause's keyboard
  handling was pulled out of the big keybindings dispatcher into its own dedicated
  keydown/keyup effect (a plain keydown-fires-immediately branch can't tell a tap from
  the first instant of a hold). `keydown` starts a 200ms timer (comfortably below
  macOS's own ~500-600ms key-repeat delay, so a snappy tap can't accidentally cross
  it); if it's still held when the timer fires AND something's actually playing, it
  calls `setPlaybackRate(2, false)`. `keyup` checks whether the timer had already
  fired — if not, it's a tap and calls the exact same `handleTogglePlay()` a plain
  press always did; if so, it just resets the rate via `resetSpaceHold()` without
  touching play state. `e.repeat` (true for OS auto-repeat while a key is held) gates
  whether a *new* hold starts tracking, but **`e.preventDefault()` still runs on every
  qualifying keydown, repeats included** — get that order wrong (checking `e.repeat`
  before `preventDefault()`, as an early return) and only the first keydown of a hold
  is ever prevented, so every auto-repeat after it falls through to space's default
  browser action (scroll the nearest scrollable ancestor — the track list or the grid,
  same fix covers both): invisible on a quick tap, a rapid repeated scroll for the
  whole duration of a hold. Root-caused live, not guessed, after exactly that shipped
  once. `isTypingTarget()` (a module-level function, shared with the main dispatcher
  rather than reimplemented) still wins over all of this — a space in a text field
  always just types a space.

  `resetSpaceHold()` is the one place a hold ever gets undone, called from: a real
  `keyup`; `handleFinish` (track ending, including repeat-one restarting the *same*
  track — the reset has to run before that branch too); a `useEffect` on
  `[playingTrackId, view]` (track switch or view change by any means); the instant
  Settings/the search overlay/any modal opens, however it was opened; and a `window`
  `'blur'` listener — specifically for Cmd+Tabbing away mid-hold, where **no `keyup`
  for the held key ever reaches this window at all** (the OS keeps tracking that
  keypress once focus leaves), so `blur` is the only signal available for that case,
  independent of whatever key state the OS still thinks is active.
- **Scroll-to-scrub**: `onWheel` on the waveform's wrapper, proportional to
  `e.deltaY` (`skip(-e.deltaY * 0.01)`, clamped to ±2s per event) — deliberately *not*
  a fixed jump, after a flat "3 seconds per wheel event" was reported as too coarse
  for trackpads.
- **Artwork extraction bug (root-caused, fixed)**: `music-metadata-browser` throws
  `ReferenceError: Buffer is not defined` in a real Electron renderer (Node's `Buffer`
  global doesn't exist there — this is the classic gotcha where a Node-derived diagnostic
  script gives a false negative because it runs in real Node, where `Buffer` *is*
  defined). `parseTrack.js`'s `catch` swallows the error and silently falls back to
  filename-only metadata + no artwork, which looked exactly like "this file just has
  no embedded art" until traced via renderer console forwarding. Fixed by importing
  the `buffer` npm polyfill and setting `window.Buffer = window.Buffer || Buffer` in
  `src/main.jsx`, before anything else runs. **Do not remove this** — metadata/artwork
  parsing silently degrades (no error surfaced to the user) without it.

## UI / design philosophy (accumulated from direct feedback)

- **Decoupled browse vs. play** (see above) is a hard product requirement now, not a
  nice-to-have — the user was explicit and repeated this request after the first
  implementation attempt regressed it.
- **Minimal, native-feeling, not skeuomorphic.** Emoji icons were explicitly replaced
  with flat inline SVG (`VolumeIcon.jsx`) after being called "dated." Native OS form
  controls (e.g. a plain `<input type="range">` relying on `accent-color`) were also
  called dated and replaced with a custom-styled slider (thin track, hidden-until-hover
  thumb, Spotify/Apple-influenced).
- **No purple/accent color on neutral chrome.** The app's purple/pink accent
  (`--accent`, `--accent-dim`, and the waveform's violet-to-orange progress gradient)
  is fine on the *waveform* and album-art-adjacent surfaces, but the user explicitly
  asked to remove it from the volume slider and from tag-filter chips in both themes —
  those now use `var(--text-primary)`/neutral grays instead of `var(--accent-dim)`.
  Don't reintroduce purple on generic UI chrome without checking first.
- **Subtle "Apple-like" micro-interactions are wanted broadly**: hover-scale on
  tracks/buttons/inputs (~1.01–1.15x, `transition: transform 0.12–0.15s ease`), a
  cursor-tracking 3D tilt on album art (`src/lib/artworkTilt.js`,
  `perspective(700px) rotateX/rotateY`), and a scale/fade `view-enter` keyframe
  animation applied to `.sidebar`, `.now-playing`, and `.focus-view` on mount (used for
  the fullscreen-toggle and mini-toggle transitions, since those are full
  conditional-unmount swaps rather than the persistent-node pattern used for the
  waveform). The list⇄grid swap reuses `view-enter` on `.track-list`/`.track-grid`
  (`.view-swap`) — they already conditionally unmount on toggle, so no key/reflow
  trick is needed. Grid additionally staggers its tiles in top-left→bottom-right via
  a per-tile `--stagger` delay (`grid-tile-in`, `backwards` fill so the held
  transform doesn't fight `:hover`; capped ~26 tiles so a big library still lands
  fast). Both respect `prefers-reduced-motion`.
- **Escape in the search field** (`LibraryList` `onKeyDown`): first press clears a
  non-empty query, a second press (or Escape on an empty field) blurs it.
- **Everything reactive to music should feel "reactive," not decorative-on-a-timer.**
  Both visualizers (main EQ strip, background-bar mini meter) sample real decoded
  audio amplitude at the current playhead — never a canned/fake animation loop. This
  was explicitly requested after an earlier whole-waveform-container pulse (driven by
  the same real data, just applied as a transform/glow on the whole block) was called
  "barely visible."
- **Real OS behavior over in-app simulation, when asked.** Fullscreen toggle and mini
  mode are both explicitly *not* real OS-level window states (fullscreen is an
  in-window view swap, not `win.setFullScreen()`) — except mini mode, which *is* now a
  real `BrowserWindow` resize, specifically because the fake in-window version was
  rejected. If the user asks for "real" OS behavior for something else (real
  fullscreen, always-on-top, multiple windows), take that literally rather than
  defaulting to a cheaper in-app simulation.
- **Keyboard-first.** Every action added should get a keybinding, and every new
  keybinding should be added to `DEFAULT_KEYBINDINGS` in `src/lib/keybindings.js` so
  it shows up in Settings automatically — the user has repeatedly asked "make sure you
  add all new key commands to my settings menu."

## Things Claude should never break

1. **`<WaveformSlot>` must never be conditionally unmounted** while playback might be
   happening, and neither may any view that renders one (`NowPlaying`, `FocusView`,
   `MiniPlayer`). Hide with CSS (`view-hidden`), never conditional rendering, and
   drive which slot owns the host via its `active` prop. This rule drifted once and
   caused a measured playback pause on every view switch — see the `active`
   contract under "Single shared WaveSurfer instance" above (tag
   `waveformslot-fixed`) and `docs/TESTING-waveformslot.md` before touching it.
2. **`window.Buffer` polyfill in `src/main.jsx`** — removing it silently breaks all
   metadata/artwork parsing with no visible error.
3. **`electron/preload.cjs` must stay `.cjs`**, and `electron/main.js` must reference
   it as `preload.cjs`, not `.js`.
4. **Re-sign after every `electron:build`** (`codesign --sign - --force --deep`)
   before trying to launch the packaged app, or Gatekeeper hard-blocks it.
5. **`vite.config.js`'s `server.watch.ignored: ['**/release/**']`** — removing it
   brings back spurious full-page reloads whenever a packaged build exists on disk.
6. **`currentTime` throttle in `App.jsx`** (`handleTimeUpdate`, 200ms) — don't feed
   raw `audioprocess` events straight into `setCurrentTime` again; it reintroduces the
   "laggy, needs two clicks" complaint.
7. **`audioUrl` must derive from `playingTrackId`, never `currentTrackId`.** This is
   the entire mechanism that keeps browsing from interrupting playback.
8. Don't reintroduce **DevTools auto-open** on launch (`openDevTools()` in
   `main.js`'s `isDev` branch) — explicitly removed at the user's request. Console
   forwarding (`console-message` listener) covers debugging needs without it.
9. **Paths are `relPath`s, and a bad one fails loudly.** The renderer never holds an
   absolute library path; `assertRelPath` / `resolveRel` throw on anything absolute or
   escaping the root. Don't add a fallback that quietly accepts an absolute path or an
   `undefined` — that is the exact bug class the rename exists to catch.
10. **The snapshot writer runs only in `libraryPhase === 'ready'`**, and the merge rules
    live in `src/lib/syncMerge.js` with tests. Never snapshot an empty/half-loaded
    library as this machine's truth, never stamp an unstamped record with `Date.now()`
    (see "Merge rules"), and never apply a merge while a text field has focus.
