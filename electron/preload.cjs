const { contextBridge, ipcRenderer } = require('electron');

// Lets the renderer ask the main process to physically shrink/restore the
// OS window for mini-player mode, since that can't be done from web APIs.
contextBridge.exposeInMainWorld('electronAPI', {
  enterMiniMode: (width, height) => ipcRenderer.send('enter-mini-mode', { width, height }),
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode'),
  // W/A/S/D + arrow keys, sent from App.jsx only while view === 'mini' —
  // moves the card one edge at a time on whichever axis `direction`
  // names ('up' | 'down' | 'left' | 'right'), animated the same way the
  // corner-snap glide is. See main.js's 'move-mini-window' handler.
  moveMiniWindow: (direction) => ipcRenderer.send('move-mini-window', direction),
  // Whole-mini-window hover, computed in main via screen.getCursorScreenPoint()
  // vs. the window's own bounds (see startMiniHoverPolling in main.js) —
  // OS-level truth, not a DOM mouseenter/mouseleave pair, because those fed a
  // feedback loop with the hover-revealed controls changing the window's own
  // -webkit-app-region hit-test layout. Only fires while in mini mode, and
  // only on an actual inside/outside change. Returns an unsubscribe fn.
  onMiniHoverChange: (cb) => {
    const listener = (_event, hovering) => cb(hovering);
    ipcRenderer.on('mini-hover-change', listener);
    return () => ipcRenderer.removeListener('mini-hover-change', listener);
  },
  // opens a native dialog where files AND folders are both selectable at
  // once, recursively scans any selected folders for audio, and returns
  // {name, path} pairs (not file contents — see main.js for why) for every
  // audio file found
  selectAudioImport: () => ipcRenderer.invoke('select-audio-import'),
  // reads one file's bytes at a time — called once per file so a big
  // folder import never serializes everything through IPC in one message
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),

  // --- media library ---
  // Every path that crosses this bridge in either direction is a `relPath`
  // relative to the configured library root (POSIX slashes) — EXCEPT
  // selectAudioFile / selectAudioImport / readAudioFile, which deal in
  // absolute paths of *source* files picked in a native dialog. Main throws
  // on any relPath that isn't a clean path inside the root.
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  mediaCopyIn: (opts) => ipcRenderer.invoke('media:copy-in', opts), // -> { relPath }
  mediaExists: (relPaths) => ipcRenderer.invoke('media:exists', relPaths),
  mediaDelete: (relPath) => ipcRenderer.invoke('media:delete', relPath),
  mediaRename: (opts) => ipcRenderer.invoke('media:rename', opts), // { relPath, title } -> relPath
  revealLibraryDir: () => ipcRenderer.invoke('media:reveal-library'),
  // the per-machine library root: { root, exists, machineId }. chooseLibraryRoot
  // opens the native folder picker and returns the same shape, or null on cancel.
  getLibraryRoot: () => ipcRenderer.invoke('library:get-root'),
  chooseLibraryRoot: () => ipcRenderer.invoke('library:choose-root'),

  // --- library sync snapshots (<root>/.playdisc/, see main.js) ---
  syncListArt: () => ipcRenderer.invoke('sync:list-art'),
  // { json, art: [{ name, bytes }] } -> { file, artWritten, bytes }
  syncWriteSnapshot: (payload) => ipcRenderer.invoke('sync:write-snapshot', payload),
  // -> [{ file, own, doc }]
  syncReadSnapshots: () => ipcRenderer.invoke('sync:read-snapshots'),
  syncReadArt: (name) => ipcRenderer.invoke('sync:read-art', name), // -> bytes | null
  syncDeleteOwnSnapshot: () => ipcRenderer.invoke('sync:delete-own-snapshot'),
  // conflicted copies (Dropbox) that the renderer has merged; main only ever
  // deletes names that look like conflicted copies
  syncDeleteConflictedCopies: (names) => ipcRenderer.invoke('sync:delete-conflicted-copies', names),
  // Live watching (main.js fsWatch on the library root, debounced). Each
  // returns an unsubscribe fn. Payload: { files: string[], reason }.
  //   sync-dir-changed      -> something under .playdisc/ changed (or 'resume')
  //   library-files-changed -> audio files arrived / moved / vanished
  onSyncDirChanged: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('sync-dir-changed', listener);
    return () => ipcRenderer.removeListener('sync-dir-changed', listener);
  },
  onLibraryFilesChanged: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('library-files-changed', listener);
    return () => ipcRenderer.removeListener('library-files-changed', listener);
  },

  // --- app / settings ---
  appVersion: () => ipcRenderer.invoke('app:version'),
  // opens a URL in the user's real default browser (shell.openExternal),
  // never inside an Electron window. Used by the update-check banner/
  // Settings button to open a GitHub release page. Resolves false if main
  // rejected the url (non-http(s) scheme).
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // native menu "Settings…" (Cmd+,) asks the renderer to open its settings
  // window. Returns an unsubscribe fn.
  onOpenSettings: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  // Cmd+W / the native close button: tell main whether a modal is currently
  // open (it gates the window's real close event on this), and listen for
  // main asking us to close whichever one is open instead of the window.
  setModalOpen: (isOpen) => ipcRenderer.send('set-modal-open', isOpen),
  onCloseActiveModal: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('close-active-modal', listener);
    return () => ipcRenderer.removeListener('close-active-modal', listener);
  },
  // OS-level media keys — literal F7/F8/F9 and the Media* keys, registered
  // always (launch to quit) in main.js via globalShortcut. Payload is one of
  // 'playpause' | 'previous' | 'next'. Returns an unsubscribe fn.
  onMediaKey: (cb) => {
    const listener = (_event, action) => cb(action);
    ipcRenderer.on('media-key', listener);
    return () => ipcRenderer.removeListener('media-key', listener);
  }
});
