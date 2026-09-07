import { withV } from '../lib/updateCheck';

// Quiet "a newer release exists" notice — library view only (see App.jsx).
// Text-led, no icon, no accent color: a notice, not an alert. Clicking
// anywhere but the dismiss button opens the release's GitHub page via
// shell.openExternal (real browser, not an in-app window — see
// preload.cjs's openExternal). Dismissing is per-version (App.jsx stamps
// localStorage with the dismissed tag), so a newer release still surfaces
// even after this one's been dismissed.
export default function UpdateToast({ current, latest, onOpen, onDismiss }) {
  return (
    <div className="update-toast" onClick={onOpen} role="button" tabIndex={0}>
      <button
        type="button"
        className="update-toast-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss update notice"
      >
        ×
      </button>
      <div className="update-toast-title">Playdisc {withV(latest)} is available</div>
      <div className="update-toast-sub">You're on {withV(current)}</div>
    </div>
  );
}
