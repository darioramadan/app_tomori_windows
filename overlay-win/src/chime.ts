let ctx: AudioContext | null = null;

/** Two soft notes; the webview is started with autoplay allowed. */
export function playChime(): void {
  try {
    const audio = (ctx ??= new AudioContext());
    const t = audio.currentTime;
    for (const [freq, delay] of [[880, 0], [1318.5, 0.14]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.55);
    }
  } catch {
    // no audio device
  }
}
