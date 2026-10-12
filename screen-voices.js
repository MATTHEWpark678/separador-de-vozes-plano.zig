import { h, button, segmented, toast, fmtTime, parseTime } from './dom.js';
import { state, go, player } from './state.js';
import * as store from './store.js';
import { loadPlayer } from './mixer-items.js';

export function voicesScreen() {
  const song = state.song;
  if (!song?.stems.voz) {
    go('player');
    return { el: h('div') };
  }
  loadPlayer(song, true);
  const dur = player.duration;
  const segs = song.meta.segments;
  let singer = 'A';
  const timer = setInterval(() => { now.textContent = `Agora: ${fmtTime(player.position)}`; }, 250);
  const now = h('p', { class: 'time' }, 'Agora: 0:00');
  const start = h('input', { type: 'text', inputmode: 'numeric', id: 'seg-start', placeholder: '0:10', 'aria-label': 'Início do trecho' });
  const end = h('input', { type: 'text', inputmode: 'numeric', id: 'seg-end', placeholder: '0:42', 'aria-label': 'Fim do trecho' });
  const err = h('p', { class: 'warn', role: 'alert', hidden: true });
  const list = h('ul', { class: 'segs', 'aria-label': 'Trechos marcados' });
  const bar = h('div', { class: 'timeline', role: 'img', 'aria-label': 'Linha do tempo dos cantores' });

  async function persist() {
    song._split = null;
    if (song.meta.saved) {
      try { await store.updateSong({ ...song.meta, segments: segs }); } catch (e) { toast(`Não consegui guardar as marcações: ${e.message}`); }
    }
    loadPlayer(song, true);
    draw();
  }
  function draw() {
    segs.sort((a, b) => a.start - b.start);
    bar.replaceChildren(...segs.map((s) => h('span', { class: `seg-bar singer-${s.singer}`, style: `left:${(s.start / dur) * 100}%;width:${((s.end - s.start) / dur) * 100}%` }, s.singer)));
    list.replaceChildren(...segs.map((s, i) => h('li', { class: 'seg-item' }, h('span', {}, `Cantor ${s.singer}, de ${fmtTime(s.start)} a ${fmtTime(s.end)}`),
      h('span', { class: 'row-tight' },
        button('Editar', { variant: 'ghost', onClick: () => { start.value = fmtTime(s.start); end.value = fmtTime(s.end); singer = s.singer; segs.splice(i, 1); persist(); } }),
        button('Apagar', { variant: 'ghost', ariaLabel: `Apagar trecho do cantor ${s.singer}`, onClick: () => { segs.splice(i, 1); persist(); } })))));
    if (!segs.length) list.replaceChildren(h('li', { class: 'help' }, 'Nenhum trecho marcado ainda.'));
  }
  function add() {
    const a = parseTime(start.value);
    const b = parseTime(end.value);
    const fail = (m) => { err.hidden = false; err.textContent = m; };
    if (a == null || b == null) return fail('Escreva os tempos assim: 1:05');
    if (a < 0 || b > dur + 0.5 || b - a < 0.2) return fail(`O fim precisa ser depois do início e dentro da música (${fmtTime(dur)}).`);
    if (segs.some((s) => a < s.end && b > s.start)) return fail('Este trecho se sobrepõe a outro. Apague ou edite o outro primeiro.');
    err.hidden = true;
    segs.push({ start: a, end: Math.min(b, dur), singer });
    start.value = '';
    end.value = '';
    persist();
  }
  draw();

  const playBtn = button('Tocar / pausar', { variant: 'secondary', onClick: async () => { player.playing ? player.pause() : await player.play(); } });
  return {
    el: h('main', { class: 'screen' },
      h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: () => go('player') }), h('h1', { tabindex: '-1' }, 'Vozes A e B')),
      h('p', { class: 'help' }, 'Ouça a música e marque quem canta em cada trecho. No mixer, a voz vira três faixas: Voz A, Voz B e o que ficou sem marcação.'),
      h('div', { class: 'row' }, playBtn, now),
      bar,
      h('section', { class: 'seg-form' },
        h('div', { class: 'two' }, h('label', { for: 'seg-start' }, 'Início'), start, button('Usar agora', { variant: 'ghost', onClick: () => { start.value = fmtTime(player.position); } })),
        h('div', { class: 'two' }, h('label', { for: 'seg-end' }, 'Fim'), end, button('Usar agora', { variant: 'ghost', onClick: () => { end.value = fmtTime(player.position); } })),
        segmented({ label: 'Cantor', value: singer, options: [{ value: 'A', label: 'Cantor A' }, { value: 'B', label: 'Cantor B' }], onChange: (v) => { singer = v; } }),
        err,
        button('Adicionar trecho', { variant: 'primary', onClick: add })),
      list,
      h('p', { class: 'help' }, 'Separar voz principal e coros, ou duetos, automaticamente: ainda não está disponível neste app (precisa de um modelo que não está ligado).')),
    leave: () => { clearInterval(timer); player.pause(); },
  };
}
