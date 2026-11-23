// Vault Heist SFX (Batch 2 #5): all sounds are synthesized with the Web Audio API,
// with no audio files at all. The AudioContext is created lazily and only
// resumed from a user-gesture handler, per browser autoplay policy.
// The mute choice is stored in localStorage and honored by every player.

const MUTE_KEY = "vaultheist:muted";

let ctx: AudioContext | null = null;
let muted =
  typeof window !== "undefined" &&
  (() => {
    try {
      return window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  })();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* localStorage unavailable: ignore */
  }
}

function ac(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  endFreq?: number;
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone({ freq, endFreq, type = "sine", dur = 0.15, gain = 0.06, delay = 0 }: ToneOpts): void {
  const audio = ac();
  if (!audio) return;
  try {
    const t0 = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    /* audio failed: stay silent */
  }
}

function noiseBurst(dur = 0.12, gain = 0.1, cutoff = 500, delay = 0): void {
  const audio = ac();
  if (!audio) return;
  try {
    const t0 = audio.currentTime + delay;
    const len = Math.max(1, Math.floor(audio.sampleRate * dur));
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const env = audio.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env).connect(audio.destination);
    src.start(t0);
  } catch {
    /* audio failed: stay silent */
  }
}

// A short mechanical click when an agent is added / removed (pitch differs by direction).
export function playTick(up: boolean): void {
  tone({ freq: up ? 1350 : 950, type: "square", dur: 0.045, gain: 0.035 });
  noiseBurst(0.03, 0.02, 3000);
}

// Batch 5: INTERACTION vs CONFIRMATION sounds are separated. This soft click only
// marks a button press (no result yet). The confirmation sounds
// (playLock / playSonar) only play AFTER the transaction has truly
// succeeded, so a wallet-rejected transaction does not sound successful.
export function playClick(): void {
  tone({ freq: 2100, type: "square", dur: 0.03, gain: 0.018 });
  noiseBurst(0.025, 0.012, 4000);
}

// A very soft tick when the allocation slider value changes during a drag (Batch 5).
// Only called when the integer value actually changes, with low gain so
// a long drag does not become a stream of sounds.
export function playSliderTick(): void {
  tone({ freq: 1150, type: "square", dur: 0.03, gain: 0.012 });
}

// A double sonar ping, hacking vibe: CONFIRMATION that the Scout transaction succeeded
// and was recorded onchain (Batch 5; previously it played when the button was pressed).
export function playSonar(): void {
  tone({ freq: 880, endFreq: 1320, type: "sine", dur: 0.18, gain: 0.05 });
  tone({ freq: 880, endFreq: 1320, type: "sine", dur: 0.22, gain: 0.03, delay: 0.16 });
}

// A rising blip when the Scout value is successfully decrypted and displayed.
export function playReveal(): void {
  tone({ freq: 620, type: "triangle", dur: 0.09, gain: 0.055 });
  tone({ freq: 930, type: "triangle", dur: 0.14, gain: 0.055, delay: 0.08 });
}

// A heavy steel-lock sound: CONFIRMATION that submitAllocation succeeded and was recorded
// onchain (Batch 5; previously it played when LOCK IN was pressed, before
// encryption and wallet approval).
export function playLock(): void {
  tone({ freq: 140, endFreq: 55, type: "sine", dur: 0.28, gain: 0.14 });
  noiseBurst(0.14, 0.1, 420);
  tone({ freq: 320, endFreq: 180, type: "square", dur: 0.07, gain: 0.03, delay: 0.1 });
}

// A short two-tone siren when a vault alarm goes off.
export function playSiren(): void {
  for (let i = 0; i < 3; i++) {
    tone({ freq: 660, type: "square", dur: 0.13, gain: 0.028, delay: i * 0.26 });
    tone({ freq: 880, type: "square", dur: 0.13, gain: 0.028, delay: i * 0.26 + 0.13 });
  }
}

// A classic two-tone coin chime when loot is won.
export function playCoin(): void {
  tone({ freq: 988, type: "square", dur: 0.09, gain: 0.04 });
  tone({ freq: 1319, type: "square", dur: 0.3, gain: 0.04, delay: 0.09 });
}

// A soft ding when a vault is revealed safe during the dramatic reveal.
export function playChime(): void {
  tone({ freq: 1175, type: "triangle", dur: 0.22, gain: 0.045 });
  tone({ freq: 1568, type: "sine", dur: 0.3, gain: 0.03, delay: 0.07 });
}
