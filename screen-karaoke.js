import { h, button, icon, toast, fmtTime } from './dom.js';
import { state, go, player } from './state.js';
import * as store from './store.js';
import { decodeToStereo } from './decode.js';
import { encodeWav16 } from './wav.js';
import { startRecording, shiftTrack } from './player.js';
import { loadPlayer } from './mixer-items.js';

export function karaokeScreen() {
  const song = state.song;
  if (!song) {
    go('library');
    return { el: h('div') };
  }
  player.setSpeed(1); // a gravação só combina com velocidade normal; o tom pode mudar
  loadPlayer(song, false);
  const voiceIds = () => player.mix.stems.filter((s) => s.id.startsWith('voz')).map((s) => s.id);
  voiceIds().forEach((id) => player.setVolume(id, 0));

  let rec = null;
  let latency = song.latencyMs ?? -150;
  const status = h('p', { class: 'time', role: 'status' }, 'Pronto para gravar.');
  const recBtn = h('button', { type: 'button', class: 'rec', 'aria-pressed': 'false', onclick: () => (rec ? stop() : start()) }, h('span', { class: 'rec-dot' }), h('span', {}, 'Gravar'));
  const playBtn = button('Ouvir com a música', { variant: 'secondary', icon: 'play', disabled: !song.recording, onClick: async () => { player.seek(0); await player.play(); } });
  const saveBtn = button('Guardar gravação', { variant: 'secondary', icon: 'save', disabled: !song.recordingRaw, onClick: saveRec });
  let tick = 0;
  let t0 = 0;

  async function start() {
    player.pause();
    player.seek(0);
    try {
      rec = await startRecording();
    } catch (err) {
      toast(err.message, 6000);
      return;
    }
    if (song.recording) player.setVolume('gravacao', 0);
    await player.play();
    player.onEnded = () => stop();
    t0 = performance.now();
    tick = setInterval(() => { status.textContent = `Gravando… ${fmtTime((performance.now() - t0) / 1000)}`; }, 250);
    recBtn.setAttribute('aria-pressed', 'true');
    recBtn.classList.add('on');
    recBtn.lastChild.textContent = 'Parar';
  }
  async function stop() {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearInterval(tick);
    player.pause();
    player.onEnded = null;
    recBtn.setAttribute('aria-pressed', 'false');
    recBtn.classList.remove('on');
    recBtn.lastChild.textContent = 'Gravar';
    status.textContent = 'Processando a gravação…';
    try {
      const blob = await r.stop();
      const d = await decodeToStereo(await blob.arrayBuffer());
      song.recordingRaw = { left: d.left, right: d.right };
      applyLatency();
      status.textContent = 'Gravação pronta. Ajuste a sincronia se precisar.';
      playBtn.disabled = false;
      saveBtn.disabled = false;
    } catch (err) {
      status.textContent = 'Não consegui usar a gravação.';
      toast(err.message ?? String(err), 6000);
    }
  }
  function applyLatency() {
    if (!song.recordingRaw) return;
    song.latencyMs = latency;
    song.recording = shiftTrack(song.recordingRaw, latency);
    loadPlayer(song, false);
    voiceIds().forEach((id) => player.setVolume(id, guide.value / 100));
  }
  async function saveRec() {
    if (!song.meta.saved) return toast('Salve a música primeiro (volte e toque em Salvar).', 5000);
    try {
      await store.saveRecording({ id: store.newId(), songId: song.meta.id, createdAt: Date.now(), wav: encodeWav16(song.recordingRaw.left, song.recordingRaw.right, 44100) });
      toast('Gravação guardada.');
    } catch (e) {
      toast(`Não consegui guardar: ${e.message}`, 6000);
    }
  }

  const guide = h('input', { type: 'range', min: '0', max: '100', value: '0', id: 'guide', 'aria-label': 'Voz original como guia', oninput: (e) => voiceIds().forEach((id) => player.setVolume(id, Number(e.target.value) / 100)) });
  const lat = h('input', { type: 'range', min: '-400', max: '400', step: '10', value: String(latency), id: 'lat', 'aria-label': 'Ajuste de sincronia em milissegundos' });
  const latOut = h('output', {}, `${latency} ms`);
  lat.addEventListener('input', () => { latOut.textContent = `${lat.value} ms`; });
  lat.addEventListener('change', () => { latency = Number(lat.value); applyLatency(); });

  const pitchVal = h('output', {}, `${player.semitones > 0 ? '+' : ''}${player.semitones}`);
  const setPitch = (d) => {
    const n = Math.max(-6, Math.min(6, player.semitones + d));
    player.setSemitones(n);
    pitchVal.textContent = `${n > 0 ? '+' : ''}${n}`;
  };

  return {
    el: h('main', { class: 'screen' },
      h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: () => go('player') }), h('h1', { tabindex: '-1' }, 'Karaokê')),
      h('p', { class: 'warn-soft' }, 'Use fones de ouvido para não gravar o som da música.'),
      h('div', { class: 'stepper' }, h('span', { class: 'step-title' }, 'Tom'), button('', { variant: 'secondary', icon: 'minus', ariaLabel: 'Diminuir tom', onClick: () => setPitch(-1) }), pitchVal, button('', { variant: 'secondary', icon: 'plus', ariaLabel: 'Aumentar tom', onClick: () => setPitch(1) })),
      h('label', { class: 'slider-row', for: 'guide' }, h('span', {}, 'Voz original (guia)'), guide),
      h('div', { class: 'center' }, recBtn, status),
      h('div', { class: 'stack' }, playBtn,
        h('label', { class: 'slider-row', for: 'lat' }, h('span', {}, 'Sincronia'), lat, latOut),
        h('p', { class: 'help' }, 'Se a sua voz sair atrasada em relação à música, mova para a esquerda; se sair adiantada, para a direita.'),
        saveBtn,
        button('Exportar', { variant: 'primary', icon: 'download', onClick: () => go('export') }))),
    leave: () => { clearInterval(tick); player.pause(); player.onEnded = null; rec?.stop?.(); },
  };
}
