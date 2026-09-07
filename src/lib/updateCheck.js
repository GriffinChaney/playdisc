// Beta-distribution update check: fetches the latest GitHub Release and
// compares its tag to the running app's own version (package.json's
// `version`, read via window.electronAPI.appVersion() -> app.getVersion()).
// No download/install — this only ever produces a "there's a newer one"
// signal + the release's own html_url to open. See CLAUDE.md "Beta
// distribution & update checks".
//
// The version comparison ONLY works if package.json's version is bumped to
// match the git tag pushed for a release — see scripts/release.mjs, the one
// place that bump is supposed to happen.

const RELEASES_URL = 'https://api.github.com/repos/GriffinChaney/playdisc/releases/latest';

function versionParts(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

// 1 if a > b, -1 if a < b, 0 if equal. Purely numeric dotted comparison —
// tags/version strings here are always plain X.Y.Z, no prerelease suffixes.
export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Display helper: package.json's version has no leading "v" but a GitHub
// tag does — normalize both to "vX.Y.Z" wherever they're shown together so
// they read as the same kind of thing.
export function withV(v) {
  return `v${String(v || '').replace(/^v/i, '')}`;
}

// Never throws — a launch-time check must not be able to block launch or
// surface an error. Resolves to:
//   { error: true }
//   { error: false, current, latest, htmlUrl, updateAvailable }
export async function checkForUpdate(currentVersion) {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return { error: true };
    const data = await res.json();
    const latest = data?.tag_name;
    const htmlUrl = data?.html_url;
    if (!latest || !htmlUrl) return { error: true };
    return {
      error: false,
      current: currentVersion,
      latest,
      htmlUrl,
      updateAvailable: compareVersions(latest, currentVersion) > 0
    };
  } catch {
    return { error: true };
  }
}
