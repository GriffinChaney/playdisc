import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const DEFAULT_MIN_WIDTH = 900;
const DEFAULT_MIN_HEIGHT = 560;
const MINI_WIDTH = 240;
const MINI_HEIGHT = 240;

// remembers the window's size/position from before it shrank into mini
// mode, so leaving mini mode restores exactly where you were
let boundsBeforeMini = null;

const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'icon-256.png');

function createWindow() {
  // open at roughly Raycast's "Almost Maximize": fill the display's work area
  // (below the menu bar, beside the dock) inset by a small even margin
  const { workArea } = screen.getPrimaryDisplay();
  const margin = Math.round(Math.min(workArea.width, workArea.height) * 0.03);
  const width = Math.max(DEFAULT_MIN_WIDTH, workArea.width - margin * 2);
  const height = Math.max(DEFAULT_MIN_HEIGHT, workArea.height - margin * 2);

  const win = new BrowserWindow({
    title: 'Sona',
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    backgroundColor: '#111111',
    icon: APP_ICON_PATH,
    // pass the click through when the window is activated by that click,
    // instead of macOS's default of swallowing the first click just to
    // focus the window — that was why the first track-select after launch
    // (or after switching back from another app) never registered
    acceptFirstMouse: true,
    // hides the native title-bar strip (keeping just the traffic-light
    // buttons, inset into the content) for a cleaner, more app-like window
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // DevTools no longer auto-open on every launch — open manually with
    // Cmd+Option+I if needed. Renderer console output is still forwarded
    // to this terminal either way, since that doesn't require the panel.
    win.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message);
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Shrinks/restores the real OS window for mini-player mode. Web APIs can't
// resize the window itself, only its content, so this has to happen here.
ipcMain.on('enter-mini-mode', (event, { width = MINI_WIDTH, height = MINI_HEIGHT } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  boundsBeforeMini = win.getBounds();
  win.setMinimumSize(Math.min(width, 160), Math.min(height, 160));
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 20;
  win.setResizable(true); // setBounds can be ignored if the window is currently non-resizable
  win.setBounds({
    x: workArea.x + margin,
    y: workArea.y + margin,
    width,
    height
  });
  win.setResizable(false);
  // no title bar strip is visible at mini size anyway — drop the traffic
  // lights too so it reads as a clean little card, not a shrunken window.
  // The card itself is now the drag handle (see .mini-player's
  // -webkit-app-region: drag in styles.css).
  win.setWindowButtonVisibility?.(false);
});

ipcMain.on('exit-mini-mode', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.setResizable(true);
  win.setMinimumSize(DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT);
  win.setWindowButtonVisibility?.(true);
  if (boundsBeforeMini) {
    win.setBounds(boundsBeforeMini);
    boundsBeforeMini = null;
  }
});

app.whenReady().then(() => {
  // packaged builds pick up assets/icon.icns via package.json's build.mac.icon
  // automatically, but a dev run launched via `electron .` shows Electron's
  // default dock icon unless we set it explicitly here.
  if (isDev) app.dock?.setIcon(APP_ICON_PATH);

  // Sona is entirely local playback — it never needs camera/mic/etc — but
  // Electron's default packaged Info.plist ships placeholder usage
  // descriptions for them (see afterPack.cjs, which strips those keys too).
  // Denying every permission request here is a second layer: it stops the
  // request before it can reach the OS-level TCC prompt at all.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
