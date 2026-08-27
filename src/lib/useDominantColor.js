import { useEffect, useState } from 'react';
import { getDominantColor } from './dominantColor';

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
