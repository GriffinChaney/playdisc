import { openDB } from 'idb';

const DB_NAME = 'my-music-player';
const DB_VERSION = 2;
const STORE = 'tracks';
const PLAYLISTS = 'playlists';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v1: the tracks store. Guarded by oldVersion so an existing v1
        // database isn't asked to re-create a store it already has.
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('dateAdded', 'dateAdded');
        }
        // v2: playlists. A playlist is just a named, ordered list of track
        // ids pointing back into the tracks store — deleting one never
        // touches the tracks themselves.
        if (oldVersion < 2) {
          db.createObjectStore(PLAYLISTS, { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
}

// track shape:
// {
//   id: string,
//   title: string,
//   artist: string,
//   duration: number,          // seconds
//   audioBlob: Blob,           // the actual audio file
//   artworkBlob: Blob | null,  // extracted cover art, if any
//   tags: string[],
//   dateAdded: number          // epoch ms, used for sorting
// }

export async function addTrack(track) {
  const db = await getDB();
  await db.put(STORE, track);
  return track;
}

export async function getAllTracks() {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function updateTrack(id, changes) {
  const db = await getDB();
  const existing = await db.get(STORE, id);
  if (!existing) return null;
  const updated = { ...existing, ...changes };
  await db.put(STORE, updated);
  return updated;
}

export async function deleteTrack(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

// playlist shape:
// {
//   id: string,
//   name: string,
//   trackIds: string[],   // ordered; references tracks.id
//   pinned: boolean,
//   createdAt: number,
//   updatedAt: number
// }

export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll(PLAYLISTS);
}

export async function putPlaylist(playlist) {
  const db = await getDB();
  await db.put(PLAYLISTS, playlist);
  return playlist;
}

export async function deletePlaylistRecord(id) {
  const db = await getDB();
  await db.delete(PLAYLISTS, id);
}
