import { h, button, toast, progressBar, download } from './dom.js';
import { state, go, player, STEM_LABEL } from './state.js';
import { renderMix } from './player.js';
import { encodeWav16 } from './wav.js';
import { loadPlayer, currentMixItems } from './mixer-items.js';

const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'musica';

export function exportScreen() {
  const song = state.song;
  if (!song) {
    go('library');
    return { el: h('div') };
  }
  loadPlayer(song, true);
  const bar = progressBar();
  const box = h('div', { hidden: true }, bar.el);
  const busyBtns = [];
  async function wrap(fn) {
    busyBtns.forEach((b) => (b.disabled = true));
    box.hidden = false;
    bar.set(0, 'Preparando…');
    try {
      await fn();
      toast('Arquivo pronto. Veja nos downloads.', 5000);
    } catch (e) {
      toast(`Não deu para exportar: ${e.message ?? e}`, 7000);
    } finally {
      busyBtns.forEach((b) => (b.disabled = false));
      box.hidden = true;
    }
  }
  const mk = (label, fn, variant = 'secondary') => {
    const b = button(label, { variant, icon: 'download', onClick: () => wrap(fn) });
    busyBtns.push(b);
    return b;
  };
  const mixBtn = mk('Mixagem atual (WAV)', async () => {
    const wav = await renderMix(currentMixItems(), { speed: player.speed, semitones: player.semitones }, (f) => bar.set(f, `Gerando… ${Math.round(f * 100)}%`));
    download(new Blob([wav], { type: 'audio/wav' }), `${safe(song.name)} - mixagem.wav`);
  }, 'primary');
  const stemBtns = Object.entries(song.stems).map(([id, s]) =>
    mk(`Só ${STEM_LABEL[id] ?? id} (WAV)`, async () => {
      download(new Blob([encodeWav16(s.left, s.right, 44100)], { type: 'audio/wav' }), `${safe(song.name)} - ${STEM_LABEL[id] ?? id}.wav`);
    }));
  const recBtn = song.recordingRaw
    ? mk('Só a minha gravação (WAV)', async () => {
        download(new Blob([encodeWav16(song.recording.left, song.recording.right, 44100)], { type: 'audio/wav' }), `${safe(song.name)} - minha voz.wav`);
      })
    : null;

  return {
    el: h('main', { class: 'screen' },
      h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: () => go('player') }), h('h1', { tabindex: '-1' }, 'Exportar')),
      h('p', { class: 'help' }, 'A mixagem usa os volumes, mudo/solo, tom e velocidade que estão no mixer agora (e a sua gravação, se houver). As faixas soltas saem sem alteração de tom e velocidade.'),
      box,
      h('div', { class: 'stack' }, mixBtn, ...stemBtns, recBtn)),
  };
}
