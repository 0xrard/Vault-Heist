// SFX Vault Heist (Batch 2 #5): semua suara disintesis Web Audio API,
// tanpa file audio sama sekali. AudioContext dibuat malas (lazy) dan hanya
// di-resume dari handler gestur user, sesuai kebijakan autoplay browser.
// Pilihan mute tersimpan di localStorage dan dihormati semua pemutar.

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
    /* localStorage tidak tersedia: abaikan */
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
    /* audio gagal: diamkan */
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
    /* audio gagal: diamkan */
  }
}

// Klik mekanik pendek saat agen ditambah / dikurangi (pitch beda arah).
export function playTick(up: boolean): void {
  tone({ freq: up ? 1350 : 950, type: "square", dur: 0.045, gain: 0.035 });
  noiseBurst(0.03, 0.02, 3000);
}

// Batch 5: suara INTERAKSI vs KONFIRMASI dipisah. Klik lembut ini hanya
// menandai tombol ditekan (belum ada hasil apa pun). Suara konfirmasi
// (playLock / playSonar) baru berbunyi SETELAH transaksi benar-benar
// berhasil, jadi transaksi yang ditolak wallet tidak terdengar sukses.
export function playClick(): void {
  tone({ freq: 2100, type: "square", dur: 0.03, gain: 0.018 });
  noiseBurst(0.025, 0.012, 4000);
}

// Tick sangat lembut saat nilai slider alokasi berubah saat drag (Batch 5).
// Hanya dipanggil saat nilai integer benar-benar berubah, gain kecil agar
// drag panjang tidak menjadi rentetan bunyi.
export function playSliderTick(): void {
  tone({ freq: 1150, type: "square", dur: 0.03, gain: 0.012 });
}

// Ping sonar dua kali, nuansa hacking: KONFIRMASI transaksi Scout berhasil
// tercatat onchain (Batch 5; sebelumnya berbunyi saat tombol ditekan).
export function playSonar(): void {
  tone({ freq: 880, endFreq: 1320, type: "sine", dur: 0.18, gain: 0.05 });
  tone({ freq: 880, endFreq: 1320, type: "sine", dur: 0.22, gain: 0.03, delay: 0.16 });
}

// Blip naik saat nilai Scout berhasil terdekripsi dan tampil.
export function playReveal(): void {
  tone({ freq: 620, type: "triangle", dur: 0.09, gain: 0.055 });
  tone({ freq: 930, type: "triangle", dur: 0.14, gain: 0.055, delay: 0.08 });
}

// Bunyi kunci baja berat: KONFIRMASI submitAllocation berhasil tercatat
// onchain (Batch 5; sebelumnya berbunyi saat LOCK IN ditekan, sebelum
// enkripsi dan persetujuan wallet).
export function playLock(): void {
  tone({ freq: 140, endFreq: 55, type: "sine", dur: 0.28, gain: 0.14 });
  noiseBurst(0.14, 0.1, 420);
  tone({ freq: 320, endFreq: 180, type: "square", dur: 0.07, gain: 0.03, delay: 0.1 });
}

// Sirine dua nada pendek saat alarm brankas meledak.
export function playSiren(): void {
  for (let i = 0; i < 3; i++) {
    tone({ freq: 660, type: "square", dur: 0.13, gain: 0.028, delay: i * 0.26 });
    tone({ freq: 880, type: "square", dur: 0.13, gain: 0.028, delay: i * 0.26 + 0.13 });
  }
}

// Denting koin klasik dua nada saat loot didapat.
export function playCoin(): void {
  tone({ freq: 988, type: "square", dur: 0.09, gain: 0.04 });
  tone({ freq: 1319, type: "square", dur: 0.3, gain: 0.04, delay: 0.09 });
}

// Ding lembut saat brankas terungkap aman selama dramatic reveal.
export function playChime(): void {
  tone({ freq: 1175, type: "triangle", dur: 0.22, gain: 0.045 });
  tone({ freq: 1568, type: "sine", dur: 0.3, gain: 0.03, delay: 0.07 });
}
