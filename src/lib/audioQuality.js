// Helpers for showing the fidelity of an imported file. Playdisc never re-encodes
// audio — it plays the exact bytes you imported through an <audio> element —
// so what these report is genuinely what you hear.

function cleanCodec(codec) {
  if (!codec) return null;
  return String(codec)
    .replace(/MPEG\s*1\s*Layer\s*3/i, 'MP3')
    .replace(/MPEG\s*2\s*Layer\s*3/i, 'MP3')
    .replace(/Ogg\s*Vorbis/i, 'Vorbis')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLossless(audio) {
  if (!audio) return false;
  if (audio.lossless === true) return true;
  return /\b(FLAC|ALAC|PCM|WAV|WAVE|AIFF|Monkey|WavPack|TAK)\b/i.test(audio.codec || '');
}

// "Beats a streaming service": lossless always does; for lossy, 320 kbps is
// the ceiling Spotify/YouTube Music offer, so match-or-better counts.
export function beatsStreaming(audio) {
  if (!audio) return false;
  if (isLossless(audio)) return true;
  return (audio.bitrate || 0) >= 320000;
}

// true hi-res: lossless AND above CD (44.1 kHz / 16-bit)
export function isHiRes(audio) {
  if (!isLossless(audio)) return false;
  return (audio.sampleRate || 0) > 48000 || (audio.bitsPerSample || 0) > 16;
}

// short chips like ["FLAC", "44.1 kHz", "16-bit"] or ["MP3", "320 kbps"]
export function qualityChips(audio) {
  if (!audio) return [];
  const chips = [];
  const codec = cleanCodec(audio.codec);
  if (codec) chips.push(codec);
  if (audio.sampleRate) {
    const khz = audio.sampleRate / 1000;
    chips.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`);
  }
  if (audio.bitsPerSample) chips.push(`${audio.bitsPerSample}-bit`);
  else if (audio.bitrate) chips.push(`${Math.round(audio.bitrate / 1000)} kbps`);
  return chips;
}

// one-word tier for a badge
export function qualityTier(audio) {
  if (!audio) return null;
  if (isHiRes(audio)) return 'hi-res';
  if (isLossless(audio)) return 'lossless';
  if ((audio.bitrate || 0) >= 320000) return 'high';
  if ((audio.bitrate || 0) >= 192000) return 'good';
  return audio.bitrate ? 'lossy' : null;
}
