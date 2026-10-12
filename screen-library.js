import { h, button, icon, toast, fmtTime, fmtBytes, sheet } from './dom.js';
import { state, go } from './state.js';
import * as store from './store.js';
import { storageLevel } from './mix.js';
import { decodeToStereo } from './decode.js';
import { runBenchmark, giveModelFile } from './client.js';
import { rememberSpeed, fmtMinutes } from './job.js';
import { progressScreen } from './screen-progress.js';

export function libraryScreen(ctx) {
  const list = h('ul', { class: 'songs', 'aria-label': 'Músicas salvas' });
  const meter = h('section', { class: 'meter', 'aria-label': 'Espaço usado' });
  const empty = h('div', { class: 'empty' }, h('p', {}, 'Nenhuma música ainda. Importe uma para separar.'));
  const file = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac', hidden: true });

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    toast('Lendo a música…', 30000);
    try {
      const d = await decodeToStereo(await f.arrayBuffer());
      state.pending = { file: f, name: f.name.replace(/\.[^.]+$/, ''), duration: d.duration, left: d.left, right: d.right };
      toast('Pronto.', 1000);
      go('mode');
    } catch (err) {
      toast(err.message, 6000);
    }
    file.value = '';
  });

  async function refresh() {
    const [songs, u] = await Promise.all([store.listSongs(), store.usage()]);
    list.replaceChildren(
      ...songs.map((s) =>
        h(
          'li',
          {},
          h(
            'button',
            { class: 'song', type: 'button', 'aria-label': `${s.name}, ${fmtTime(s.duration)}, salva`, onclick: () => open(s.id) },
            h('span', { class: 'song-name' }, s.name),
            h('span', { class: 'song-meta' }, `${fmtTime(s.duration)} · ${s.stemNames.length} faixas · ${fmtBytes(s.bytes ?? 0)}`),
            h('span', { class: 'badge' }, 'Salva'),
          ),
        ),
      ),
    );
    empty.hidden = songs.length > 0;
    const lvl = storageLevel(u.usage, u.quota);
    meter.replaceChildren(...[
      h('p', {}, `O app usa ${fmtBytes(u.usage)}${u.quota ? ` de ${fmtBytes(u.quota)} possíveis` : ''}`),
      h('div', { class: `progress level-${lvl.level}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(lvl.fraction * 100)) }, h('div', { class: 'fill', style: `width:${lvl.fraction * 100}%` })),
      lvl.level !== 'normal' ? h('p', { class: 'warn' }, lvl.level === 'cheio' ? 'Espaço quase cheio. Apague músicas antigas.' : 'Espaço ficando curto.') : null,
      songs.length ? button('Apagar a mais antiga', { variant: 'ghost', icon: 'trash', onClick: () => deleteOldest(songs) }) : null,
    ].filter(Boolean));
  }

  async function deleteOldest(songs) {
    const old = songs[songs.length - 1];
    if (!confirm(`Apagar "${old.name}" do aparelho? Isso não dá para desfazer.`)) return;
    await store.deleteSong(old.id);
    toast('Música apagada.');
    refresh();
  }

  function open(id) {
    ctx.show(
      progressScreen({
        title: 'Abrindo a música…',
        start: ({ set }) => {
          set(null, 'Lendo as faixas salvas…');
          return (async () => {
            const r = await store.loadSong(id);
            const recs = await store.listRecordings(id);
            if (recs.length) {
              const last = recs.sort((a, b) => b.createdAt - a.createdAt)[0];
              const { decodeWav16 } = await import('./wav.js');
              const d = decodeWav16(last.wav);
              r.recordingRaw = { left: d.left, right: d.right };
              r.recording = r.recordingRaw;
            }
            return r;
          })();
        },
        onDone: ({ meta, stems, recording, recordingRaw }) => {
          state.song = { name: meta.name, stems, meta, recording, recordingRaw };
          go('player', {});
        },
        onCancel: () => go('library'),
        onFail: () => {},
      }),
    );
  }

  function testPhone() {
    ctx.show(
      progressScreen({
        title: 'Testando o seu celular',
        start: ({ status }) => runBenchmark(status),
        onDone: (seconds) => {
          rememberSpeed(seconds);
          go('library');
          const sh = sheet({
            title: 'Resultado do teste',
            children: [
              h('p', {}, `Uma parte de 7,8 s da música levou ${seconds.toFixed(1)} s.`),
              h('p', {}, `Uma música de 3 min e 30 s deve levar cerca de ${fmtMinutes((210 / 7.8) * 1.2 * seconds)} no modo Rápido e ${fmtMinutes((210 / 7.8) * 2 * seconds)} no Máxima (estimativa).`),
              h('div', { class: 'row' }, button('Fechar', { variant: 'primary', onClick: () => sh.close() })),
            ],
          });
        },
        onCancel: () => go('library'),
      }),
    );
  }

  function advanced() {
    const f = h('input', { type: 'file', accept: '.onnx', hidden: true });
    f.addEventListener('change', async () => {
      const m = f.files?.[0];
      if (!m) return;
      toast('Guardando o modelo…', 30000);
      try {
        await giveModelFile(await m.arrayBuffer());
        toast('Modelo guardado. Pode separar.');
      } catch (err) {
        toast(err.message, 6000);
      }
    });
    const s = sheet({
      title: 'Avançado',
      children: [
        h('p', { class: 'help' }, 'Se o download automático do modelo falhar, baixe o arquivo htdemucs_fp16weights.onnx em outro lugar e escolha-o aqui.'),
        f,
        h('div', { class: 'row' }, button('Escolher arquivo do modelo', { onClick: () => f.click() }), button('Fechar', { variant: 'ghost', onClick: () => s.close() })),
      ],
    });
  }

  const el = h(
    'main',
    { class: 'screen' },
    h('header', { class: 'bar' }, h('h1', { tabindex: '-1' }, 'Separador de Vozes'), button('', { variant: 'ghost', icon: 'gear', ariaLabel: 'Avançado', onClick: advanced })),
    meter,
    empty,
    list,
    file,
    h('div', { class: 'stack' }, button('Importar música', { variant: 'primary', icon: 'import', onClick: () => file.click() }), button('Testar meu celular', { variant: 'secondary', onClick: testPhone })),
  );
  refresh().catch((e) => toast(`Não consegui ler a biblioteca: ${e.message}`));
  return { el };
}
