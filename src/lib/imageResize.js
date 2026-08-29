// Downscale a user-picked image (playlist cover) so a big photo doesn't bloat
// IndexedDB. Keeps aspect ratio, caps the longest edge, re-encodes as JPEG
// (or PNG when it might have transparency). Returns a Blob, or the original
// blob untouched if anything goes wrong.
export function resizeImage(blob, maxEdge = 600, quality = 0.85) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        resolve(blob);
        return;
      }
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      const cw = Math.round(w * scale);
      const ch = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      const type = /png|webp/i.test(blob.type) ? 'image/png' : 'image/jpeg';
      canvas.toBlob(
        (out) => resolve(out && out.size < blob.size ? out : blob),
        type,
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.src = url;
  });
}
