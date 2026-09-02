// Cover-derived "aurora" mesh backdrop, shared by the fullscreen focus view
// and the mini-player so the two stay identical. Several colors sampled from
// the current cover, each pooled in its own region of the frame and blended
// across the middle, over a dark base so it never falls to black. Falls back
// to the older single-color radial while the palette is still sampling, then
// to nothing (caller keeps its default background) if there's no artwork.
//
// Blob positions are percentages, so the same gradient scales cleanly to any
// container — a full-screen view or the small mini-player window.
const BLOB_POS = ['22% 24%', '80% 18%', '68% 78%', '16% 82%', '48% 46%'];

function withAlpha(rgb, a) {
  return rgb.replace('rgb(', 'rgba(').replace(')', `, ${a})`);
}

// palette: { colors: string[], base: string } | null   (useArtworkPalette)
// dominantColor: { vivid, dark, darker } | null         (useDominantColor)
export function meshBackdropStyle(palette, dominantColor) {
  if (palette) {
    return {
      backgroundColor: palette.base,
      backgroundImage: palette.colors
        .map(
          (c, i) =>
            `radial-gradient(circle at ${BLOB_POS[i % BLOB_POS.length]}, ${withAlpha(c, 0.85)} 0%, transparent 60%)`
        )
        .join(', ')
    };
  }
  if (dominantColor) {
    return {
      background: `radial-gradient(ellipse 150% 110% at 50% 10%, ${dominantColor.vivid} 0%, ${dominantColor.dark} 60%, ${dominantColor.darker} 100%)`
    };
  }
  return undefined;
}
