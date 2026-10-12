// Lê um arquivo de áudio qualquer (mp3, m4a, wav, ogg...) e devolve estéreo a 44,1 kHz.
const RATE = 44100;
const AC = () => window.AudioContext || window.webkitAudioContext;

export async function decodeToStereo(arrayBuffer) {
  const ctx = new (AC())({ sampleRate: RATE });
  try {
    let ab;
    try {
      ab = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      throw new Error('Não consegui abrir este arquivo de áudio. Tente mp3, m4a, wav ou ogg.');
    }
    if (ab.sampleRate !== RATE) {
      const off = new OfflineAudioContext(2, Math.ceil((ab.length * RATE) / ab.sampleRate), RATE);
      const src = off.createBufferSource();
      src.buffer = ab;
      src.connect(off.destination);
      src.start();
      ab = await off.startRendering();
    }
    const left = ab.getChannelData(0).slice();
    const right = (ab.numberOfChannels > 1 ? ab.getChannelData(1) : ab.getChannelData(0)).slice();
    return { left, right, duration: left.length / RATE, sampleRate: RATE };
  } finally {
    ctx.close?.();
  }
}
