# Library sync between two Macs — plan

Branch: `library-sync`. Pre-work tag: `pre-sync-rework` (on `main`, `3f4adf0`).
Approved 2026-09-06. Existing libraries on both machines will be wiped; no data
migration is needed.

## Goal

The audio files live in a Dropbox folder that both machines sync. The app's
metadata (playlists, tags, notes, versions, liked state, custom titles/artists,
cover art edits) must sync too, so both machines show the same library.

## Decisions (locked)

1. **Relative paths.** Versions store a path relative to a per-machine
   *library root* chosen once in Settings. The two machines' absolute roots
   are assumed to differ (different Dropbox locations are fine, that is
   exactly what the per-machine root handles).
2. **One sync file per machine**, not one shared file. Each machine writes
   only `sync/<machineId>.json` and reads all of them. A file with a single
   writer never produces a Dropbox "conflicted copy". Each file is that
   machine's full merged snapshot, so any one file can bootstrap a new
   machine, and reading = fold over every file in the directory.
3. **Per-item timestamps, newest wins per item.** Plus tombstones (deletes
   are recorded, not removed) and per-note stamps (notes merge by id, so a
   note edit and a like on the same track don't collide). Playlist
   `trackIds` merges as a whole array.
4. **Write immediately (debounced), read on focus / resume / file change.**
   No continuous polling.
5. **Copy-in stays** for stage 1. "Adopt in place" for sources already under
   the root comes later.
6. **Cover art as separate content-addressed files**, `art/<sha256>.<ext>`,
   referenced from the JSON by hash. Never base64 in the JSON.
7. Dropbox mode is not a concern: both machines keep files fully local. Just
   make the folder picker work wherever Dropbox lives.

## Findings

### Where absolute paths live today

- `version.filePath` on every version record (`src/lib/media.js` makeVersion,
  `src/lib/parseTrack.js`). Nothing else on a track or playlist holds a path.
- `playdisc-media://f/<encoded absolute path>` — built in `src/lib/media.js`
  `mediaUrl`, served by `protocol.handle` in `electron/main.js`, gated on
  `startsWith(LIBRARY_DIR)`.
- `LIBRARY_DIR` hardcoded in `electron/main.js`; used by copy-in,
  write-bytes, delete, rename, fix-extension, library-dir, reveal. Every media
  IPC accepts or returns absolute paths.
- `missingPaths` state in `App.jsx` — a Set of absolute paths, threaded into
  LibraryList / VersionsModal / NowPlaying.
- Handlers: import, rename version, delete version, add version, relocate,
  delete track, the missing-file sweep.
- Three one-time migrations in `App.jsx` (`sona:mediaMigration`,
  `sona:extFix`, `sona:versionTitles`) walk every version with absolute
  paths. **Deleted in stage 1** rather than adapted.
- Settings shows the folder path.

### What syncs vs. what stays local

Syncs: tracks minus blobs; playlists minus the image blob; `libraryOrder`
(the hand-dragged Imported order, currently localStorage, but it's library
data). A playlist's `sort`/`sortDir` sit on the record and sync with it.

Stays local: theme, gradient slider (`backgroundMovement`), volume, shuffle,
repeat, both column widths, `layoutDefaults`, list/grid mode, the
Imported/Liked/artist sort prefs, keybindings + schema flag, history panel
state, `playHistory`, the queue (in-memory).

### Watching a Dropbox file from Electron

Watch the sync **directory** with `fs.watch` from main, never the file.
Dropbox stages incoming content in `.dropbox.cache/new_files` and renames it
into place, so the inode changes and a file-level watch dies after the first
update; a directory watch sees the rename. Electron 31 = Node 20.18, whose
macOS `fs.watch` is FSEvents-backed and sees Dropbox's writes. Debounce
300–500 ms, parse with retry, skip our own file. Recursive watching (native
on macOS) lets the missing-file sweep re-run when an audio file lands. Add a
focus read and a `powerMonitor` resume read as belt and braces. Our own
writes go temp-file-then-rename so Dropbox never uploads a half-written JSON.

## Target shape

- Version: `{ id, title, originalTitle, relPath, duration, format,
  fingerprint, dateAdded }` — `relPath` is POSIX-slashed, exactly the existing
  `Artist — Title/title.ext` layout. Renamed from `filePath` on purpose so any
  leftover absolute-path use fails loudly.
- Main owns the root: small JSON in `userData`, chosen with a folder dialog in
  Settings. Every IPC and the protocol take relPaths; main resolves with a
  resolve-plus-prefix guard. The renderer never holds an absolute path.
- Machine id: generated UUID stored in `userData` (not the hostname).
- Sync dir layout under the root: `.playdisc/sync/<machineId>.json`,
  `.playdisc/art/<sha256>.<ext>`.
- Every synced item carries `updatedAt`; deleted items become
  `{ id, deleted: true, updatedAt }`. Local edits stamp
  `max(Date.now(), previous.updatedAt + 1)` so an edit always beats the value
  it was based on, even under clock skew.

## Stages (a working app at each)

Status: 1–5 done (tags `sync-stage1` … `sync-stage5`). Stage 5 also added the
edit guard (no merge applies while a text field has focus) — see CLAUDE.md
"Live sync triggers". Stage 4 specifics that
weren't in the plan: pre-stage-4 records are stamped once at first launch with
the machine's own last snapshot `writtenAt`; a remote record whose art hasn't
arrived is deferred whole rather than taken coverless; merges apply through
state updaters with a per-item re-check, and IndexedDB is written from
committed state. See CLAUDE.md "Sync merge".

1. **Fresh-start prep.** Delete the three migrations. Add a reset path that
   drops the IndexedDB database and the library-derived localStorage keys but
   keeps keybindings/theme/layout. Tag.
2. **Library root + relative paths, no sync.** Settings folder picker, root
   config in userData, relPath everywhere, protocol change, first-launch
   "choose a folder" gate. Test on one machine with the root inside Dropbox:
   import, play, seek, rename, add version, delete, relocate; confirm Dropbox
   uploads the files.
3. **Snapshot export + bootstrap.** Serialize tracks and playlists to the
   per-machine JSON plus art files on every change, debounced in main. On
   launch with an empty database, load from whatever snapshot files exist.
   Test: laptop builds the library, desktop launches and sees it.
4. **Merge.** `updatedAt` on every write path, tombstones, per-note stamps, a
   pure merge module with a plain node test (the repo has no test setup),
   read-and-merge on focus, and reconciliation for a track deleted remotely
   while it is current / playing / expanded / in history. Route the tag
   handlers through `patchTrack` (they call `updateTrack` directly today).
5. **Live watching.** Directory watch, debounce, focus + resume triggers,
   conflicted-copy sweep (any `*.json` in the dir is input; conflicted copies
   are merged then deleted), and a "waiting for Dropbox" state for audio that
   hasn't arrived yet.
6. **Polish.** Sync status in Settings, fingerprint dedupe on merge,
   adopt-in-place import, art GC.

## Hazards

- **Audio arrives after the JSON.** A new track shows on the other machine
  minutes before its WAV. It must read as *syncing*, not *missing*, and must
  not offer relocate.
- **Importing on both machines at once** creates two ids and two files for
  the same song. Rule until dedupe exists: import from one machine at a time.
- **A remote change to the playing track's active version or its path**
  restarts playback on the machine playing it. Rare, accepted.
- **Pre-existing race:** `updateTrack` in `src/lib/db.js` is read-modify-write
  across separate transactions. Sync writes must serialize from React state,
  never from IndexedDB.
- **Copy-in duplicates** any source file already in Dropbox until
  adopt-in-place exists.
- **The old library stays.** `~/Music/Sona Library/` (3.3 GB) and the frozen
  `~/Library/Application Support/Sona/` profile are orphaned by this, not
  deleted.
