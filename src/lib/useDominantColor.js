import { useEffect, useState } from 'react';
import { getDominantColor, getArtworkPalette } from './dominantColor';

// Re-extracts whenever the artwork blob changes (i.e. on track switch);
// returns null while pending or when there's no artwork to sample.
export function useDominantColor(artworkBlob) {
  const [color, setColor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!artworkBlob) {
      setColor(null);
      return;
    }
    getDominantColor(artworkBlob).then((c) => {
      if (!cancelled) setColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [artworkBlob]);

  return color;
}

// Multi-color palette for the fullscreen mesh-gradient backdrop. Returns
// { colors: string[], base: string } or null while pending / no artwork.
export function useArtworkPalette(artworkBlob) {
  const [palette, setPalette] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!artworkBlob) {
      setPalette(null);
      return;
    }
    getArtworkPalette(artworkBlob).then((p) => {
      if (!cancelled) setPalette(p);
    });
    return () => {
      cancelled = true;
    };
  }, [artworkBlob]);

  return palette;
}
