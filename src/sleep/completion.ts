// Chime and vibration when a job finishes. The AudioContext is created during
// the tap that starts sleep mode, because browsers only allow sound that was
// unlocked by a user gesture.

let ctx: AudioContext | null = null;

export function unlockSound(): void {
  ctx ??= new AudioContext();
  void ctx.resume().catch(() => {});
}

export function chime(): void {
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.05;
  // Two soft notes, E5 then A5.
  [659.25, 880].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + i * 0.28;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
}

export function buzz(): void {
  navigator.vibrate?.([200, 100, 200, 100, 400]);
}
