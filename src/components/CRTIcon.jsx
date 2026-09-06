// Flat, minimal CRT-monitor glyph (no emoji), matched to the app's other
// icons (ShuffleIcon/VolumeIcon/RestartIcon): 15px box, ~1.6 stroke weight.
// A slightly bulged screen + one scanline reads as "retro display" without
// needing more detail than that at this size.
export default function CRTIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 5.5C3 4.67 3.67 4 4.5 4h15c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-15C3.67 17 3 16.33 3 15.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6 10.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 20.5h6M12 17v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
