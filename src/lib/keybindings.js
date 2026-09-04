const STORAGE_KEY = 'keybindings';
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export const DEFAULT_KEYBINDINGS = {
  playPause: { label: 'play / pause', key: 'space' },
  next: { label: 'next track', key: 'd' },
  prev: { label: 'previous track', key: 'u' },
  nextAlt: { label: 'next track (alt)', key: 'arrowright' },
  prevAlt: { label: 'previous track (alt)', key: 'arrowleft' },
  fullscreen: { label: 'toggle fullscreen', key: 'f' },
  miniPlayer: { label: 'toggle mini player', key: 'm' },
  expandTrack: { label: 'expand track row', key: 'z' },
  expandNotes: { label: 'expand notes panel', key: 'n' },
  toggleLibraryView: { label: 'grid / list view', key: 'v' },
  toggleNav: { label: 'hide / show playlists', key: 'tab' },
  seekBack: { label: 'seek back 5s', key: 'h' },
  seekForward: { label: 'seek forward 5s', key: 'l' },
  scrollDown: { label: 'scroll library down', key: 'j' },
  scrollUp: { label: 'scroll library up', key: 'k' },
  restart: { label: 'restart track', key: 'r' },
  volumeUp: { label: 'volume up', key: 'arrowup' },
  volumeDown: { label: 'volume down', key: 'arrowdown' },
  shuffle: { label: 'toggle shuffle', key: 's' },
  search: { label: 'focus search', key: 'mod+s' }
  // NOTE: "open settings" is intentionally NOT here — Cmd+, is a fixed native
  // menu accelerator (electron/main.js app menu), not a rebindable action,
  // matching standard macOS Preferences behavior.
};

export function loadKeybindings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    saved = {};
  }
  const merged = {};
  for (const action of Object.keys(DEFAULT_KEYBINDINGS)) {
    merged[action] = { ...DEFAULT_KEYBINDINGS[action], key: saved[action] || DEFAULT_KEYBINDINGS[action].key };
  }
  return merged;
}

export function saveKeybindings(bindings) {
  const toSave = {};
  for (const action of Object.keys(bindings)) toSave[action] = bindings[action].key;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

// Normalizes a KeyboardEvent into the same string format bindings are
// stored as, so a live keydown can be matched against them directly.
export function eventToKeyString(e) {
  const mod = e.metaKey || e.ctrlKey ? 'mod+' : '';
  if (e.code === 'Space') return `${mod}space`;
  return `${mod}${e.key.toLowerCase()}`;
}

export function formatKeyLabel(keyStr) {
  return keyStr
    .split('+')
    .map((part) => {
      if (part === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (part === 'space') return 'Space';
      if (part === 'arrowup') return '↑';
      if (part === 'arrowdown') return '↓';
      if (part === 'arrowleft') return '←';
      if (part === 'arrowright') return '→';
      return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join(isMac ? '' : '+');
}
