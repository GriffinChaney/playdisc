const { contextBridge, ipcRenderer } = require('electron');

// Lets the renderer ask the main process to physically shrink/restore the
// OS window for mini-player mode, since that can't be done from web APIs.
contextBridge.exposeInMainWorld('electronAPI', {
  enterMiniMode: (width, height) => ipcRenderer.send('enter-mini-mode', { width, height }),
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode'),
  // opens a native dialog where files AND folders are both selectable at
  // once, recursively scans any selected folders for audio, and returns
  // {name, path} pairs (not file contents — see main.js for why) for every
  // audio file found
  selectAudioImport: () => ipcRenderer.invoke('select-audio-import'),
  // reads one file's bytes at a time — called once per file so a big
  // folder import never serializes everything through IPC in one message
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),

  // --- media library (versioning) ---
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  mediaCopyIn: (opts) => ipcRenderer.invoke('media:copy-in', opts),
  mediaWriteBytes: (opts) => ipcRenderer.invoke('media:write-bytes', opts),
  mediaExists: (paths) => ipcRenderer.invoke('media:exists', paths),
  mediaDelete: (filePath) => ipcRenderer.invoke('media:delete', filePath),
  mediaRename: (opts) => ipcRenderer.invoke('media:rename', opts),
  mediaFixExtension: (filePath) => ipcRenderer.invoke('media:fix-extension', filePath),
  mediaLibraryDir: () => ipcRenderer.invoke('media:library-dir'),
  revealLibraryDir: () => ipcRenderer.invoke('media:reveal-library'),

  // --- app / settings ---
  appVersion: () => ipcRenderer.invoke('app:version'),
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
  }
});
