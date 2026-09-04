const STORAGE_KEY = 'keybindings';
// bump when a future change needs another one-time fix-up of saved bindings
const SCHEMA_KEY = 'keybindingsSchema';
const SCHEMA_VERSION = 'v1';
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export const DEFAULT_KEYBINDINGS = {
  playPause: { label: 'play / pause', key: 'space' },
  // next/prev live on the arrows only now — d/u used to double as a primary
  // binding here (via the old nextAlt/prevAlt actions below), but they're
  // fast-scroll now; see migrateKeybindings() for existing installs.
  next: { label: 'next track', key: 'arrowright' },
  prev: { label: 'previous track', key: 'arrowleft' },
  fullscreen: { label: 'toggle fullscreen', key: 'f' },
  miniPlayer: { label: 'toggle mini player', key: 'm' },
  expandTrack: { label: 'expand + center track row', key: 'z' },
  expandNotes: { label: 'expand notes panel', key: 'n' },
  toggleLibraryView: { label: 'grid / list view', key: 'v' },
  toggleNav: { label: 'hide / show playlists', key: 'tab' },
  seekBack: { label: 'seek back 5s', key: 'h' },
  seekForward: { label: 'seek forward 5s', key: 'l' },
  scrollDown: { label: 'scroll library down', key: 'j' },
  scrollUp: { label: 'scroll library up', key: 'k' },
  scrollDownFast: { label: 'fast scroll library down', key: 'd' },
  scrollUpFast: { label: 'fast scroll library up', key: 'u' },
  restart: { label: 'restart track', key: 'r' },
  volumeUp: { label: 'volume up', key: 'arrowup' },
  volumeDown: { label: 'volume down', key: 'arrowdown' },
  shuffle: { label: 'toggle shuffle', key: 's' },
  search: { label: 'focus search', key: 'mod+s' }
  // NOTE: "open settings" is intentionally NOT here — Cmd+, is a fixed native
  // menu accelerator (electron/main.js app menu), not a rebindable action,
  // matching standard macOS Preferences behavior.
};

// One-time fix-up for installs that saved keybindings before d/u moved off
// next/previous-track (and nextAlt/prevAlt were folded into next/prev
// directly). Runs at most once, guarded by SCHEMA_KEY — never reruns once it
// has, even as a no-op, so a later real customization can't get re-migrated.
//
// Only ever touches next/prev/nextAlt/prevAlt, and only when they still hold
// exactly their OLD default value — a deliberate binding of d/u to some
// OTHER action, or of next/prev to some key that isn't the old default, is
// left completely alone.
function migrateKeybindings(saved) {
  let already;
  try {
    already = localStorage.getItem(SCHEMA_KEY) === SCHEMA_VERSION;
  } catch {
    return saved; // localStorage unusable — nothing we can safely persist
  }
  if (already) return saved;

  const next = { ...saved };
  let changed = false;

  if (next.next === 'd') {
    delete next.next; // falls back to the new default (arrowright)
    if (next.scrollDownFast === undefined) next.scrollDownFast = 'd';
    changed = true;
  }
  if (next.prev === 'u') {
    delete next.prev;
    if (next.scrollUpFast === undefined) next.scrollUpFast = 'u';
    changed = true;
  }
  // nextAlt/prevAlt no longer exist as actions — a customized one (not just
  // sitting at its old default) carries over onto the action that inherits
  // its role; an unmodified one is just dropped.
  if (next.nextAlt !== undefined) {
    if (next.nextAlt !== 'arrowright' && next.next === undefined) next.next = next.nextAlt;
    delete next.nextAlt;
    changed = true;
  }
  if (next.prevAlt !== undefined) {
    if (next.prevAlt !== 'arrowleft' && next.prev === undefined) next.prev = next.prevAlt;
    delete next.prevAlt;
    changed = true;
  }

  try {
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION);
  } catch {
    /* best effort — if this throws, the flag didn't get set and it safely
       retries next load (the logic above is idempotent) */
  }
  return next;
}

export function loadKeybindings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    saved = {};
  }
  saved = migrateKeybindings(saved);
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
