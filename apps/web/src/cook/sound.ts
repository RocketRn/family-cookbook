/**
 * FE-09 (D-050): the sound when a timer reaches zero on screen, made with the Web Audio API (no
 * file to download). Phones allow sound only after a tap, so starting a timer prepares it. A
 * device or browser without the API stays silent; the large notice and the vibration remain.
 */
type AudioCtor = new () => AudioContext;
let ctx: AudioContext | null = null;

function make(): AudioContext | null {
  const g = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    return new C();
  } catch {
    return null;
  }
}

/** Call from a tap (starting a timer). */
export function primeSound(): void {
  ctx ??= make();
  try {
    void ctx?.resume().catch(() => undefined);
  } catch {
    /* some WebViews have no resume(): the sound may still play */
  }
}

/** Three short beeps. */
export function playAlarm(): void {
  ctx ??= make();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const at = t0 + i * 0.3;
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      tone.connect(gain).connect(ctx.destination);
      tone.start(at);
      tone.stop(at + 0.22);
    }
  } catch {
    /* no sound is better than no notice */
  }
}

/** Tests only: forget the audio context, so the next timer makes a new one. */
export function __resetSound(): void {
  ctx = null;
}
