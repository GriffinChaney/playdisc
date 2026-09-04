// Ad-hoc signs the dev Electron binary that `npm run electron:dev` launches
// straight out of node_modules (node_modules/electron/dist/Electron.app).
//
// Every `npm install` re-downloads/re-extracts that binary, which lands with
// no code signature at all. On macOS that can make Gatekeeper hard-block it
// on launch — "Electron will damage your computer. You should move it to the
// Trash." — with no "Open Anyway" override in Privacy & Security, because
// there's no signing identity for Gatekeeper to let you approve. It's the
// same root cause as the packaged-app codesign gotcha documented in
// CLAUDE.md, just on the raw dev binary instead of release/mac-arm64/Playdisc.app.
//
// Run automatically via the "postinstall" script in package.json. Safe to
// run again by hand any time `npm run electron:dev` starts failing the same
// way: `node scripts/sign-dev-electron.cjs`.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

if (process.platform !== 'darwin') {
  // codesign/xattr are macOS-only; nothing to do on other platforms/CI
  process.exit(0);
}

const appPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

if (!fs.existsSync(appPath)) {
  // electron isn't installed (e.g. a partial/offline install) — nothing to sign
  process.exit(0);
}

// Clear any quarantine flag first (harmless if there isn't one) — belt and
// suspenders alongside the ad-hoc signature below.
try {
  execFileSync('xattr', ['-cr', appPath]);
} catch {
  // non-fatal — xattr missing the attribute (or missing entirely) is fine
}

try {
  execFileSync('codesign', ['--sign', '-', '--force', '--deep', appPath], { stdio: 'pipe' });
  console.log('[postinstall] ad-hoc signed dev Electron binary (' + appPath + ')');
} catch (err) {
  console.warn(
    '[postinstall] could not ad-hoc sign the dev Electron binary — ' +
      '`npm run electron:dev` may hit a Gatekeeper block. Re-run by hand: ' +
      'node scripts/sign-dev-electron.cjs\n' +
      (err.stderr ? err.stderr.toString() : err.message)
  );
}
