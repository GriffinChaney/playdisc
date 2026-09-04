import { useEffect, useState } from 'react';
import { getArtworkHash, peekArtworkHashes } from './artworkHash';

// Given a playlist's tracks in canonical (trackIds) order, resolve the first
// four VISUALLY DISTINCT cover blobs for the 2x2 fallback mosaic.
//
// - dedupe is by artwork content hash, not track and not blob identity
//   (every track parses its own Blob instance, even for one album)
// - order is stable: we always walk canonical order, so the cover doesn't
//   change when the view's sort dropdown changes
// - hashing is async; `pending` is true until the distinct set is known, so
//   the caller can hold a single-cover placeholder instead of flashing four
//   identical tiles and then rearranging
//
// Returns { blobs: Blob[] (0–4), pending: boolean }.
export function usePlaylistMosaic(orderedTracks) {
  const withArt = orderedTracks.filter((t) => t && t.artworkBlob);
  // keyed on id AND blob size, not just id membership — a cover edit
  // (change/reset) can swap one track's artwork for another without ever
  // adding or removing it from withArt, and id-only would miss that entirely
  const sig = withArt.map((t) => `${t.id}:${t.artworkBlob.size}`).join(',');

  const [state, setState] = useState(() => resolveSync(withArt));

  useEffect(() => {
    // fast path: every hash already cached (revisit) — no loading flash
    const sync = resolveSync(withArt);
    if (!sync.pending) {
      setState(sync);
      return;
    }

    let cancelled = false;
    // drop the previous playlist's tiles immediately — the caller falls back to
    // a single-cover placeholder while this resolves, rather than briefly
    // showing the mosaic we just navigated away from
    setState({ blobs: [], pending: true });

    Promise.all(withArt.map((t) => getArtworkHash(t.id, t.artworkBlob))).then((hashes) => {
      if (cancelled) return;
      setState({ blobs: pickDistinct(withArt, hashes), pending: false });
    });

    return () => {
      cancelled = true;
    };
    // withArt is rebuilt every render; sig is its stable identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return state;
}

function resolveSync(withArt) {
  const hashes = peekArtworkHashes(withArt);
  if (!hashes) return { blobs: [], pending: withArt.length > 0 };
  return { blobs: pickDistinct(withArt, hashes), pending: false };
}

function pickDistinct(withArt, hashes) {
  const seen = new Set();
  const blobs = [];
  for (let i = 0; i < withArt.length && blobs.length < 4; i++) {
    // a failed hash (null) counts as unique — never merge on uncertainty
    const key = hashes[i] || `unhashed:${withArt[i].id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blobs.push(withArt[i].artworkBlob);
  }
  return blobs;
}
