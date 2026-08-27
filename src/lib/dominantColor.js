function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}

// Samples a downscaled copy of the artwork on a canvas, averages its pixels
// (weighted toward more saturated/mid-lightness ones so a few vivid pixels
// aren't drowned out by large muted/black/white regions), then boosts the
// result's saturation and fixes its lightness into a "backdrop" range —
// otherwise most album art averages down to a muddy, low-saturation gray
// that doesn't read as "the color of the cover" the way Spotify's Canvas
// backdrops do.
export function getDominantColor(blob) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const size = 48;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);

      let rTotal = 0;
      let gTotal = 0;
      let bTotal = 0;
      let weightTotal = 0;
      try {
        const { data } = ctx.getImageData(0, 0, size, size);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const lightness = (max + min) / 2 / 255;
          const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
          const weight = 0.15 + saturation * (1 - Math.abs(lightness - 0.5) * 1.2);
          rTotal += r * weight;
          gTotal += g * weight;
          bTotal += b * weight;
          weightTotal += weight;
        }
      } catch {
        resolve(null);
        return;
      }
      if (!weightTotal) {
        resolve(null);
        return;
      }

      const avgR = rTotal / weightTotal;
      const avgG = gTotal / weightTotal;
      const avgB = bTotal / weightTotal;
      const [h, s] = rgbToHsl(avgR, avgG, avgB);
      // push toward a vivid, medium-dark backdrop tone regardless of how
      // muted/light the raw average came out
      const boostedS = Math.min(1, Math.max(s, 0.55));
      const [vr, vg, vb] = hslToRgb(h, boostedS, 0.4);
      const [dr, dg, db] = hslToRgb(h, boostedS, 0.16);
      const [xr, xg, xb] = hslToRgb(h, boostedS, 0.07);

      resolve({
        vivid: `rgb(${vr}, ${vg}, ${vb})`,
        dark: `rgb(${dr}, ${dg}, ${db})`,
        darker: `rgb(${xr}, ${xg}, ${xb})`
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
