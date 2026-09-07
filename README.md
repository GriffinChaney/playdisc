# Playdisc

> **Working on this project?** Read [`CLAUDE.md`](CLAUDE.md) for architecture,
> conventions, and things not to break, and
> [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for current bugs / in-progress
> work before making changes. This README is a lighter intro and may lag behind
> those two.

A personal, local-only music player. You add exactly the songs you want — your
own tracks, friends' mixes, downloads — and nothing else ever shows up. Desktop
app (Electron + React); library metadata in IndexedDB, audio files live in a
folder you choose and stream from disk. No server, no account, no catalog — if
that folder is in Dropbox, your library syncs between your own Macs.

## What it does

**Library**
- Import files or whole folders of `mp3 / wav / flac / m4a / aac / ogg` from a
  native picker, with a progress overlay and a confirmation toast
- Automatic ID3 / atom metadata + embedded artwork extraction on import
- Search, per-track tags (inline `+ tag`, plus bulk tag / delete on a selection),
  tag-group filtering
- Multi-select in both list and grid view — ⌘-click, shift-click, ⌘-drag to paint
  a contiguous range — with a floating action bar (queue / add-to-playlist / tag /
  delete)
- Per-track **versions** — attach alternate files (rough mix, master, demo) to one
  track and switch the active one; the displayed title follows whichever version
  is active, and a version whose file goes missing can be relocated
- Per-track **notes** — a small checklist on any track (right-click → "Versions &
  notes"); a badge shows unchecked-note count and `active-version / total`

**Playlists** (three-column library view, Spotify-style)
- **Left** — "Imported" (your whole library) + your playlists. Drag playlists to
  reorder; pin one to the top; rename; ⌘/shift-select several and delete them at
  once. Deleting a playlist never touches the songs.
- **Liked Songs** — heart any track (row, right-click, or the `like` key); Liked
  is its own view beside Imported, sorted by recently-liked, and every other view
  can sort liked-first.
- **Artist pages** — click any artist name (rows, grid tiles, now playing, focus
  view) for a page of everything by them. "Daft Punk feat. Todd Edwards" lands on
  the Daft Punk page. Escape goes back.
- **Middle** — the track list for whatever's selected, as a list or an album-art
  grid (`v` toggles); drag to reorder within a playlist. The row `×` removes from the
  current playlist (only deletes from the library in the "Imported" view). Press `z`
  to zoom into the current track (shows date added / format / size).
- **Right** — now playing: artwork (click for fullscreen), color-reactive
  waveform, pixel-art EQ, transport
- Add to a playlist by right-clicking a track (or a multi-selection), or the
  `+ playlist` button on the selection bar
- Both side columns are drag-resizable and the layout scales with the window — by
  default the track list and the artwork zone split the space after the nav roughly
  evenly. **Tab** hides the playlist nav and splits the window evenly between the
  track list and the artwork zone. Opens near-maximized.

**Playback**
- Imported audio is never transcoded — it's streamed from the original file on
  disk via a custom `playdisc-media://` protocol with range requests, so a
  lossless import (FLAC/ALAC/WAV) plays back lossless and seeking doesn't rebuffer
- Browsing a track (single click) never interrupts what's playing — a floating
  bar keeps the real playing track reachable
- Scrubbable / scroll-to-scrub waveform (wavesurfer.js)
- Manual **queue** ("up next", drag to reorder) consumed before library order
- Browser-style **play history**: Previous / Next walk what you actually played
  (with a "recently played" list you can jump around in); playing from a playlist
  keeps Next inside that playlist
- Transport: shuffle, three-state **repeat** (off → repeat-all → repeat-one), a
  **restart** button (jump the current track to 0:00 without changing play state),
  adjustable volume
- Fully rebindable keyboard shortcuts (Settings) — play/pause, next/prev, seek,
  volume, shuffle, grid/list, focus/mini toggles, and more
- **Listening stats** (Settings › Listening): total time listened, top tracks
  and top artists with play counts, summed across your Macs. A play needs 30 s
  at normal speed; time counts at any speed. Sort any view by **Most played**
  or **Least played**.
- **Option+Space** quick search — a Spotlight-style palette over any view for
  tracks, artists, playlists, Imported and Liked. Selecting a result jumps to it;
  it never changes what's playing.

**Views**
- Normal 3-column library view, a fullscreen **focus** view (ambient backdrop
  sampled from the cover art), and a real OS-window **mini** mode
- The single audio engine is shared across all views — switching never restarts
  playback

Playdisc also checks GitHub for a newer release on launch and shows a small,
dismissible notice if there is one — a link to the release page, never an
auto-update.

## Got sent this by a friend?

**Apple Silicon Macs only (M1 or later).** It won't run on an Intel Mac.

Playdisc isn't in the App Store and isn't signed with an Apple developer
certificate, so macOS will refuse to open it the first time. That's expected,
and getting past it takes about a minute — once.

1. **Download** `Playdisc-<version>.dmg` from the
   [Releases page](https://github.com/GriffinChaney/playdisc/releases/latest),
   open it, and drag Playdisc into the Applications folder shown next to it.
2. **Open Playdisc from your Applications folder.** macOS will block it with
   one of these, depending on your version:
   - *"Apple could not verify "Playdisc" is free of malware that may harm your
     Mac or compromise your privacy."* (macOS 15 Sequoia)
   - *""Playdisc" cannot be opened because the developer cannot be verified."*
     (macOS 14 Sonoma and earlier)

   Click **Done** or **Cancel** — **not "Move to Trash."**
3. **Open System Settings → Privacy & Security** and scroll down to the
   *Security* section. You'll see a line saying Playdisc was blocked, with an
   **Open Anyway** button next to it. Click it, enter your Mac password or use
   Touch ID if asked, then click **Open** in the last dialog.

That's it — after this one-time step it opens normally, like any other app.

> On macOS 14 (Sonoma) and earlier you can also skip step 3: right-click (or
> Control-click) Playdisc in Applications, choose **Open**, then **Open**
> again. This shortcut no longer works on macOS 15.

**If it still won't open, text me** — don't fight it.

Playdisc checks GitHub for newer releases when it starts and shows a small
notice in the top-right corner if there's one. It just links to the release
page — it never updates itself.

## Setup

```bash
cd playdisc
npm install
npm run electron:dev      # Vite dev server + Electron, hot reload
```

`npm run dev` alone runs it as a plain browser tab (no Electron-only features
like mini mode, but faster to iterate on UI).

### Building the app

```bash
npm run electron:build
```

electron-builder doesn't sign (no paid Apple cert), and unsigned the app hits a
hard Gatekeeper block — so `scripts/afterPack.cjs` ad-hoc signs the app during
the build, before it's packaged into the DMG.

`npm run electron:build` also produces a versioned DMG at `release/Playdisc-<version>.dmg`
— that's what gets uploaded to a GitHub Release (see "Got sent this by a friend?"
above, and `scripts/release.mjs` for cutting a release).

## Stack

React 18 (no state library — all state in `App.jsx`), Vite 5, Electron 31
(electron-builder), wavesurfer.js 7, music-metadata-browser, `idb`. Plain CSS
with custom properties, no framework, no TypeScript.

## Project structure

```
electron/
  main.js          # window + mini-mode IPC, playdisc-media:// protocol,
                   #   media-library IPC, sync file watcher, one-time profile
                   #   migration from the app's previous name
  preload.cjs      # contextBridge (must stay .cjs)
build/
  icon.png         # app icon source — electron-builder generates .icns from it
src/
  components/
    PlaylistNav.jsx    # left column: Imported + playlists + queue/history panels
    LibraryList.jsx    # middle column: track list / grid, search, tags, bulk bar
    NowPlaying.jsx     # right column: artwork + waveform + transport
    NowPlayingNotes.jsx  # notes panel under now playing
    FocusView.jsx      MiniPlayer.jsx        Waveform.jsx       WaveformSlot.jsx
    TrackItem.jsx      QueuePanel.jsx        HistoryPanel.jsx   BackgroundPlayBar.jsx
    SearchOverlay.jsx  # Option+Space quick-search palette
    UpdateToast.jsx    # "newer release available" notice, library view only
    LibrarySetup.jsx   # first-launch gate: choose the library folder
    VersionsModal.jsx  PlaylistEditModal.jsx SettingsModal.jsx  CoverEditModal.jsx
    EditArtistModal.jsx ContextMenu.jsx      PromptModal.jsx    ChoiceModal.jsx
    TagMenu.jsx        UploadButton.jsx      ImportOverlay.jsx  ImportToast.jsx
    ShuffleIcon.jsx    RepeatIcon.jsx        RestartIcon.jsx    VolumeIcon.jsx
    HeartIcon.jsx      StarIcon.jsx          NotesIcon.jsx      GearIcon.jsx
  lib/
    db.js              # IndexedDB (idb): tracks + playlists + listening stores (DB v3).
                       #   Stores metadata and paths only — audio stays on disk
    listening.js       # listening-stats accounting (sessions, totals, top lists)
    media.js           # media-library helpers, relPath contract, mediaUrl()
    syncSnapshot.js    syncMerge.js          # per-machine snapshot JSON + the pure merge (npm test)
    parseTrack.js      mediaFingerprint.js   audioQuality.js
    librarySort.js     tagOrder.js           artistName.js      shuffle.js       notes.js
    dominantColor.js   useDominantColor.js   meshBackdrop.js    # cover-art palette + backdrops
    likedBackdrop.js   artistBackdrop.js     useGradientDrift.js
    useObjectUrl.js    useListSelection.js   useNoteReorder.js  usePlaylistMosaic.js
    artworkTilt.js     artworkHash.js        imageResize.js     useWheelSlider.js
    keybindings.js     updateCheck.js        # GitHub release check for beta distribution
  App.jsx              # all state + orchestration
  styles.css
scripts/
  release.mjs          # npm run release -- X.Y.Z: bumps version, tags, pushes
```
