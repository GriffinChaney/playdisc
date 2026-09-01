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
};
