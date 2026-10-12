import { h, button, icon, toast, fmtTime, sheet } from './dom.js';
import { state, go, player, STEM_LABEL, STEM_COLOR } from './state.js';
import * as store from './store.js';
import { effectiveGains } from './mix.js';
import { loadPlayer } from './mixer-items.js';
import { progressScreen } from './screen-progress.js';

export function playerScreen(ctx) {
  const song = state.song;
  if (!song) {
    go('library');
    return { el: h('div') };
  }
  const items = loadPlayer(song, true);
  player.onEnded = () => syncPlay();
  const dur = player.duration;

  const badge = h('span', { class: 'badge' }, song.meta.saved ? 'Salva' : 'Temporária');
  const timeText = h('span', { class: 'time' }, `0:00 / ${fmtTime(dur)}`);
  const seek = h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Posição da música' });
  let dragging = false;
  seek.addEventListener('input', () => {
    dragging = true;
    player.seek((Number(seek.value) / 1000) * dur);
    updateTime();
  });
  seek.addEventListener('change', () => { dragging = false; });
  const playBtn = h('button', { class: 'play', type: 'button', 'aria-label': 'Tocar', onclick: async () => { player.playing ? player.pause() : await player.play(); syncPlay(); } }, icon('play', 28));

  function syncPlay() {
    playBtn.replaceChildren(icon(player.playing ? 'pause' : 'play', 28));
    playBtn.setAttribute('aria-label', player.playing ? 'Pausar' : 'Tocar');
  }
  function updateTime() {
    const pos = player.position;
    timeText.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
    seek.setAttribute('aria-valuetext', `${fmtTime(pos)} de ${fmtTime(dur)}`);
    if (!dragging && dur) seek.value = String(Math.round((pos / dur) * 1000));
  }
  const timer = setInterval(() => { updateTime(); if (!player.playing) syncPlay(); }, 250);

  // ---- faixas
  const rows = new Map();
  function refreshRows() {
    const gains = effectiveGains(player.mix.stems);
    player.mix.stems.forEach((s, i) => {
      const r = rows.get(s.id);
      if (!r) return;
      r.el.classList.toggle('silenced', gains[i] === 0);
      r.m.setAttribute('aria-pressed', String(s.muted));
      r.s.setAttribute('aria-pressed', String(s.solo));
      r.m.classList.toggle('on-mute', s.muted);
      r.s.classList.toggle('on-solo', s.solo);
    });
  }
  const mixer = h('section', { class: 'mixer', 'aria-label': 'Faixas' });
  for (const it of items) {
    const label = STEM_LABEL[it.id] ?? it.id;
    const st = player.mix.get(it.id);
    const vol = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(st.volume * 100)), id: `vol-${it.id}`, 'aria-label': `Volume de ${label}`, oninput: (e) => player.setVolume(it.id, Number(e.target.value) / 100) });
    const m = h('button', { type: 'button', class: 'ms', 'aria-label': `Silenciar ${label}`, 'aria-pressed': 'false', onclick: () => { player.setMuted(it.id, !player.mix.get(it.id).muted); refreshRows(); } }, 'M');
    const s = h('button', { type: 'button', class: 'ms', 'aria-label': `Só ${label} (solo)`, 'aria-pressed': 'false', onclick: () => { player.setSolo(it.id, !player.mix.get(it.id).solo); refreshRows(); } }, 'S');
    const el = h('div', { class: 'fader' }, h('div', { class: 'fader-head' }, h('span', { class: 'dot', style: `background:${STEM_COLOR[it.id] ?? 'var(--color-text-muted)'}` }), h('label', { for: `vol-${it.id}` }, label), m, s), vol);
    rows.set(it.id, { el, m, s });
    mixer.append(el);
  }
  refreshRows();

  // ---- tom e velocidade
  function stepper({ title, text, onMinus, onPlus, minusOk, plusOk, changed }) {
    const val = h('output', { class: changed() ? 'changed' : '' }, text());
    const upd = () => { val.textContent = text(); val.classList.toggle('changed', changed()); minus.disabled = !minusOk(); plus.disabled = !plusOk(); };
    const minus = h('button', { type: 'button', class: 'step', 'aria-label': `Diminuir ${title.toLowerCase()}`, onclick: () => { onMinus(); upd(); } }, icon('minus', 20));
    const plus = h('button', { type: 'button', class: 'step', 'aria-label': `Aumentar ${title.toLowerCase()}`, onclick: () => { onPlus(); upd(); } }, icon('plus', 20));
    upd();
    return h('div', { class: 'stepper' }, h('span', { class: 'step-title' }, title), minus, val, plus);
  }
  const pitch = stepper({
    title: 'Tom',
    text: () => `${player.semitones > 0 ? '+' : ''}${player.semitones}`,
    onMinus: () => player.setSemitones(player.semitones - 1),
    onPlus: () => player.setSemitones(player.semitones + 1),
    minusOk: () => player.semitones > -6,
    plusOk: () => player.semitones < 6,
    changed: () => player.semitones !== 0,
  });
  const speed = stepper({
    title: 'Velocidade',
    text: () => `${Math.round(player.speed * 100)}%`,
    onMinus: () => player.setSpeed(Math.round((player.speed - 0.05) * 100) / 100),
    onPlus: () => player.setSpeed(Math.round((player.speed + 0.05) * 100) / 100),
    minusOk: () => player.speed > 0.5001,
    plusOk: () => player.speed < 1.4999,
    changed: () => Math.abs(player.speed - 1) > 0.001,
  });

  // ---- salvar
  async function doSave(names, close) {
    const chosen = {};
    for (const n of names) chosen[n] = song.stems[n];
    try {
      const meta = await store.saveSong({ id: song.meta.id ?? store.newId(), name: song.name, createdAt: song.meta.createdAt, duration: song.meta.duration, focus: song.meta.focus, quality: song.meta.quality, segments: song.meta.segments }, chosen);
      song.meta = meta;
      badge.textContent = 'Salva';
      saveBtn.querySelector('span').textContent = 'Música salva';
      saveBtn.disabled = true;
      close?.();
      toast('Música salva no aparelho.');
    } catch (err) {
      toast(`Não consegui salvar: ${err.message ?? err}`, 7000);
    }
  }
  function chooseSheet(parent) {
    const names = Object.keys(song.stems);
    const boxes = names.map((n) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, 'data-n': n }), h('span', {}, STEM_LABEL[n] ?? n)));
    const s = sheet({
      title: 'Quais faixas salvar?',
      children: [
        h('p', { class: 'help' }, 'Salvar menos faixas gasta menos espaço.'),
        ...boxes,
        h('div', { class: 'stack' },
          button('Salvar as escolhidas', { variant: 'primary', onClick: () => {
            const picked = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.dataset.n);
            if (!picked.length) return toast('Escolha pelo menos uma faixa.');
            parent?.close();
            doSave(picked, () => s.close());
          } }),
          button('Voltar', { variant: 'ghost', onClick: () => s.close() })),
      ],
    });
  }
  function discard() {
    player.pause();
    state.song = null;
    go('library');
  }
  function saveSheet() {
    const s = sheet({
      title: 'Gostou do resultado?',
      children: [
        h('p', { class: 'help' }, 'A música só fica no aparelho se você salvar. Se descartar, ela some quando você sair.'),
        h('div', { class: 'stack' },
          button('Salvar esta música', { variant: 'primary', onClick: () => doSave(Object.keys(song.stems), () => s.close()) }),
          button('Escolher faixas para salvar', { variant: 'secondary', onClick: () => chooseSheet(s) }),
          button('Descartar', { variant: 'danger', onClick: () => { s.close(); discard(); } }),
          button('Continuar ouvindo', { variant: 'ghost', onClick: () => s.close() })),
      ],
    });
  }
  const saveBtn = button(song.meta.saved ? 'Música salva' : 'Salvar…', { variant: 'secondary', icon: 'save', disabled: song.meta.saved, onClick: saveSheet });

  function back() {
    if (song.meta.saved) { player.pause(); state.song = null; return go('library'); }
    const s = sheet({
      title: 'Sair sem salvar?',
      children: [
        h('div', { class: 'stack' },
          button('Salvar esta música', { variant: 'primary', onClick: () => { s.close(); saveSheet(); } }),
          button('Descartar e sair', { variant: 'danger', onClick: () => { s.close(); discard(); } }),
          button('Continuar aqui', { variant: 'ghost', onClick: () => s.close() })),
      ],
    });
  }

  const hasVoice = !!song.stems.voz && song.meta.focus === 'voz';
  const el = h(
    'main',
    { class: 'screen' },
    h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: back }), h('h1', { tabindex: '-1', class: 'ellipsis' }, song.name), badge),
    h('section', { class: 'transport', 'aria-label': 'Reprodução' }, seek, h('div', { class: 'transport-row' }, button('10 s', { variant: 'ghost', ariaLabel: 'Voltar 10 segundos', onClick: () => player.seek(player.position - 10) }), playBtn, button('10 s', { variant: 'ghost', ariaLabel: 'Avançar 10 segundos', onClick: () => player.seek(player.position + 10) })), timeText),
    mixer,
    h('section', { class: 'tune', 'aria-label': 'Tom e velocidade' }, pitch, speed),
    h('div', { class: 'stack' },
      saveBtn,
      button('Karaokê', { variant: 'secondary', icon: 'mic', onClick: () => go('karaoke') }),
      hasVoice ? button('Vozes (A e B)', { variant: 'secondary', icon: 'users', onClick: () => go('voices') }) : null,
      button('Exportar', { variant: 'secondary', icon: 'download', onClick: () => go('export') })),
  );
  if (state.params.justSeparated) setTimeout(saveSheet, 300);
  return { el, leave: () => { clearInterval(timer); player.pause(); player.onEnded = null; } };
}
