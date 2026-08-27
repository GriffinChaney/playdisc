const { contextBridge, ipcRenderer } = require('electron');

// Lets the renderer ask the main process to physically shrink/restore the
// OS window for mini-player mode, since that can't be done from web APIs.
contextBridge.exposeInMainWorld('electronAPI', {
  enterMiniMode: (width, height) => ipcRenderer.send('enter-mini-mode', { width, height }),
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode')
});
