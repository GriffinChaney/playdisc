// Full-screen overlay shown while songs are being imported. Determinate
// progress bar (done / total), with a moving sheen on the fill for a bit of
// "loading" motion. Rendered only while an import is in flight.
export default function ImportOverlay({ done, total, label }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const noun = total === 1 ? 'song' : 'songs';

  return (
    <div className="import-overlay">
      <div className="import-card">
        <p className="import-title">{label || `Importing ${total} ${noun}…`}</p>
        <div className="import-bar-track">
          <div className="import-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="import-count">{done} / {total}</p>
      </div>
    </div>
  );
}
