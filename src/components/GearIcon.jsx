// Flat inline gear for the Settings button. 15px, stroke = currentColor,
// matching the other UI glyphs (VolumeIcon, transport icons). Simple
// 8-tooth Apple-style gearshape (rounded ring + rounded tooth nubs) rather
// than a detailed cog — 2026-09-05: replaced an asterisk/starburst shape
// that didn't read as a gear.
export default function GearIcon() {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5.6" strokeWidth="1.8" />
      {teeth.map((deg) => (
        <rect
          key={deg}
          x="10.8"
          y="1.8"
          width="2.4"
          height="3.6"
          rx="1.1"
          fill="currentColor"
          stroke="none"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}
