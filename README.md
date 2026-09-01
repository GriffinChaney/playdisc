# Playdisc

> **Working on this project?** Read [`CLAUDE.md`](CLAUDE.md) for architecture,
> conventions, and things not to break, and
> [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for current bugs / in-progress
> work before making changes. This README is a lighter intro and may lag behind
> those two.

A personal, local-only music player. You add exactly the songs you want — your
own tracks, friends' mixes, downloads — and nothing else ever shows up. Desktop
app (Electron + React); library metadata in IndexedDB, audio files copied to
`~/Music/Sona Library/` and streamed from disk. No server, no account, no sync,
no catalog.

## What it does

**Library**
- Drag-free multi-file import for `mp3 / wav / flac / m4a / aac / ogg`, with a
  progress overlay and a slide-in confirmation toast
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
- **Middle** — the track list for whatever's selected, as a list or an album-art
  grid (`v` toggles); drag to reorder within a playlist. The row `×` removes from the
  current playlist (only deletes from the library in the "Imported" view). Press `z`
  to keep the current track zoomed (with date added / format / size); the zoom
  follows as you skip.
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

**Views**
- Normal 3-column library view, a fullscreen **focus** view (ambient backdrop
  sampled from the cover art), and a real OS-window **mini** mode
- The single audio engine is shared across all views — switching never restarts
  playback

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
codesign --sign - --force --deep "release/mac-arm64/Playdisc.app"
```

The ad-hoc re-sign is required every build — electron-builder doesn't sign
(no paid Apple cert), and unsigned the app hits a hard Gatekeeper block. See
`CLAUDE.md` for the full rebuild → re-sign → replace `/Applications/Playdisc.app`
loop.

## Stack

React 18 (no state library — all state in `App.jsx`), Vite 5, Electron 31
(electron-builder), wavesurfer.js 7, music-metadata-browser, `idb`. Plain CSS
with custom properties, no framework, no TypeScript.

## Project structure

```
electron/
  main.js          # window + mini-mode IPC, playdisc-media:// protocol,
                   #   media-library IPC, one-time Sona→Playdisc profile migration
  preload.cjs      # contextBridge (must stay .cjs)
build/
  icon.png         # app icon source — electron-builder generates .icns from it
src/
  components/
    PlaylistNav.jsx    # left column: Imported + playlists + queue/history panels
    LibraryList.jsx    # middle column: track list / grid, search, tags, bulk bar
    NowPlaying.jsx     # right column: artwork + waveform + transport
    FocusView.jsx      MiniPlayer.jsx        Waveform.jsx       WaveformSlot.jsx
    TrackItem.jsx      QueuePanel.jsx        HistoryPanel.jsx   BackgroundPlayBar.jsx
    VersionsModal.jsx  PlaylistEditModal.jsx SettingsModal.jsx
    ContextMenu.jsx    PromptModal.jsx       ChoiceModal.jsx    TagMenu.jsx
    ShuffleIcon.jsx    RepeatIcon.jsx        RestartIcon.jsx    VolumeIcon.jsx
    ImportOverlay.jsx  ImportToast.jsx       UploadButton.jsx
  lib/
    db.js              # IndexedDB (idb): tracks + playlists stores (DB v2).
                       #   Audio is on disk now, not blobs — only paths are stored
    media.js           # media-library helpers, mediaUrl(), readAudioMeta()
    mediaFingerprint.js  parseTrack.js       audioQuality.js
    dominantColor.js   useDominantColor.js   # cover-art palette sampling
    useObjectUrl.js    useListSelection.js   artworkTilt.js     imageResize.js
    keybindings.js
  App.jsx              # all state + orchestration
  styles.css
```
