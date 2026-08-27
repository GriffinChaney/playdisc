// Subtle cursor-tracking tilt for album art — a light 3D parallax effect
// on hover, reset on leave.
export function handleArtworkMouseMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width - 0.5;
  const y = (e.clientY - rect.top) / rect.height - 0.5;
  e.currentTarget.style.transform = `perspective(700px) rotateX(${y * -8}deg) rotateY(${x * 8}deg) scale(1.02)`;
}

export function handleArtworkMouseLeave(e) {
  e.currentTarget.style.transform = '';
}
