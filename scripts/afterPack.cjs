// electron-builder afterPack hook. Named .cjs (not .js) for the same reason
// as electron/preload.cjs: package.json has "type": "module", and
// electron-builder require()s this file directly, which needs CommonJS.
//
// Electron's bundled Info.plist template ships placeholder
// NSMicrophoneUsageDescription / NSCameraUsageDescription / Bluetooth usage
// strings meant for apps that use those APIs. Playdisc never does (local file
// playback only), and their mere presence appears to be what makes macOS
// show a microphone permission prompt on every launch (Chromium/CoreAudio
// eagerly checks TCC status for any declared-but-unused capability when the
// audio decoder's AudioContext spins up). Stripping the keys after packaging
// removes the prompt at the source.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const KEYS_TO_REMOVE = [
  'NSMicrophoneUsageDescription',
  'NSCameraUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription'
];

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const plistPath = path.join(context.appOutDir, appName, 'Contents', 'Info.plist');

  for (const key of KEYS_TO_REMOVE) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plistPath]);
    } catch {
      // key wasn't present — fine, nothing to remove
    }
  }

  // Ad-hoc sign HERE, not as a manual step after the build: afterPack runs
  // after the .app is assembled but BEFORE electron-builder packages it into
  // the DMG, so this is the only point where a signature can make it into
  // the DMG at all. A signature applied to release/mac-arm64/Playdisc.app
  // after the build never reaches the copy inside the DMG (found the hard
  // way on the first v0.2.0 DMG: the app inside failed codesign --verify
  // with "code has no resources", the exact "will damage your computer"
  // hard-block state). Must run after the plist edits above — changing
  // Info.plist after signing would invalidate the seal.
  const appPath = path.join(context.appOutDir, appName);
  execFileSync('codesign', ['--sign', '-', '--force', '--deep', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
