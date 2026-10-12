import { h, button, segmented, toggle, fmtTime } from './dom.js';
import { state, go, player } from './state.js';
import { runSeparation } from './client.js';
import { progressScreen } from './screen-progress.js';
import { ensureDecoded, jobFor, previewSlice, newSong, toSongStems, instrumentalOf, estimateSeconds, fmtMinutes } from './job.js';

function estimateText(p, o) {
  const s = estimateSeconds(p.duration, o.quality);
  if (s == null) return 'Ainda não medi a velocidade do seu celular. Faça "Testar meu celular" na biblioteca para ver uma estimativa de tempo.';
  return `Estimativa para esta música: cerca de ${fmtMinutes(s)} (depende do celular).`;
}

export function modeScreen(ctx) {
  const p = state.pending;
  const o = state.options;
  if (!p) {
    go('library');
    return { el: h('div') };
  }
  const options = h('div', { class: 'stack' });
  const estimate = h('p', { class: 'help' });

  function build() {
    options.replaceChildren(...[
      h('section', {}, h('h2', {}, 'Foco'), segmented({ label: 'Foco', value: o.focus, options: [{ value: 'voz', label: 'Voz' }, { value: 'instrumental', label: 'Instrumental' }], onChange: (v) => { o.focus = v; build(); } }),
        h('p', { class: 'help' }, o.focus === 'voz' ? 'Dá atenção extra à voz: separa voz e instrumental, e libera as ferramentas da voz.' : 'Separa o instrumental em bateria, baixo e outros, para você mexer em cada um.')),
      h('section', {}, h('h2', {}, 'Qualidade'), segmented({ label: 'Qualidade', value: o.quality, options: [{ value: 'rapida', label: 'Rápida' }, { value: 'maxima', label: 'Máxima' }], onChange: (v) => { o.quality = v; estimate.textContent = estimateText(p, o); } }),
        h('p', { class: 'help' }, 'A máxima demora mais e deixa as emendas entre os pedaços mais suaves.')),
      o.focus === 'voz'
        ? h('section', {}, h('h2', {}, 'Ferramentas da voz'),
            toggle({ id: 'sw-restore', label: 'Restaurar voz', help: 'Limpa chiado e eco da voz.', checked: o.restore, onChange: (v) => { o.restore = v; build(); } }),
            o.restore
              ? h('label', { class: 'slider-row' }, h('span', {}, 'Força da limpeza'), h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(o.strength * 100)), 'aria-label': 'Força da limpeza', oninput: (e) => { o.strength = Number(e.target.value) / 100; } }))
              : null,
            toggle({ id: 'sw-fill', label: 'Preencher falhas', help: 'Conserta cortes curtos na voz (experimental).', checked: o.fill, onChange: (v) => { o.fill = v; } }))
        : null,
    ].filter(Boolean));
    estimate.textContent = estimateText(p, o);
  }
  build();

  function runPreview() {
    ctx.show(
      progressScreen({
        title: 'Preparando a prévia (30 s)',
        start: async ({ set, status }) => {
          await ensureDecoded(p);
          const { left, right } = previewSlice(p);
          const job = jobFor(o);
          const run = runSeparation({ ...job, left, right, onStatus: status, onProgress: (f) => set(f, `Separando… ${Math.round(f * 100)}%`) });
          return run;
        },
        onDone: ({ stems }) => {
          state.preview = toSongStems(stems);
          go('preview');
        },
        onCancel: () => go('mode'),
      }),
    );
  }

  return {
    el: h(
      'main',
      { class: 'screen' },
      h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: () => go('library') }), h('h1', { tabindex: '-1' }, 'Como separar?')),
      h('p', { class: 'file-name' }, `${p.name} · ${fmtTime(p.duration)}`),
      options,
      estimate,
      h('div', { class: 'stack' }, button('Ouvir prévia (30 s)', { variant: 'secondary', onClick: runPreview }), button('Separar a música inteira', { variant: 'primary', onClick: () => startFull(ctx) })),
    ),
  };
}

export function startFull(ctx) {
  const p = state.pending;
  const o = { ...state.options };
  ctx.show(
    progressScreen({
      title: 'Separando a música',
      start: async ({ set, status }) => {
        await ensureDecoded(p);
        const { left, right } = p;
        p.left = null;
        p.right = null;
        const job = jobFor(o);
        return runSeparation({ ...job, left, right, onStatus: status, onProgress: (f) => set(f, `Separando… ${Math.round(f * 100)}%`) });
      },
      onDone: ({ stems }) => {
        state.song = newSong(p.name, stems, p.duration);
        go('player', { justSeparated: true });
      },
      onCancel: () => go('mode'),
    }),
  );
}

export function previewScreen(ctx) {
  const stems = state.preview;
  if (!stems) {
    go('mode');
    return { el: h('div') };
  }
  const ins = instrumentalOf(stems);
  let side = 'a';
  player.speed = 1;
  player.semitones = 0;
  player.load([
    { id: 'a', left: stems.voz.left, right: stems.voz.right, muted: false },
    { id: 'b', left: ins.left, right: ins.right, muted: true },
  ]);
  const playBtn = button('Tocar', { variant: 'primary', icon: 'play', onClick: async () => {
    if (player.playing) { player.pause(); } else { await player.play(); }
    sync();
  } });
  function sync() {
    const label = player.playing ? 'Pausar' : 'Tocar';
    playBtn.replaceChildren(...[h('span', {}, label)]);
    playBtn.setAttribute('aria-label', label);
  }
  player.onEnded = sync;
  const ab = segmented({ label: 'Lado da prévia', value: 'a', options: [{ value: 'a', label: 'A: voz' }, { value: 'b', label: 'B: instrumental' }], onChange: (v) => { side = v; player.setMuted('a', v !== 'a'); player.setMuted('b', v !== 'b'); } });

  return {
    el: h(
      'main',
      { class: 'screen' },
      h('header', { class: 'bar' }, button('', { variant: 'ghost', icon: 'back', ariaLabel: 'Voltar', onClick: () => go('mode') }), h('h1', { tabindex: '-1' }, 'Prévia')),
      h('p', { class: 'help' }, 'Um trecho de 30 s do meio da música, com os ajustes que você escolheu. Troque entre A e B para comparar.'),
      ab,
      h('div', { class: 'row' }, playBtn),
      h('div', { class: 'stack' }, button('Mudar ajustes', { variant: 'secondary', onClick: () => go('mode') }), button('Separar a música inteira', { variant: 'primary', onClick: () => startFull(ctx) })),
    ),
    leave: () => { player.pause(); player.onEnded = null; },
  };
}
