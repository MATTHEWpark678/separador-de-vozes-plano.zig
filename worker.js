// Worker: carrega o modelo e faz a separação (e a restauração da voz) fora da tela principal.
import { separate } from './chunker.js';
import { restoreVoice } from './restore.js';
import { getSession, makeModel, benchmark, cacheModelFile } from './ort-engine.js';

let aborter = null;
const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const status = (text) => post({ type: 'status', text });

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'cancel') {
      aborter?.abort();
      return;
    }
    if (m.type === 'model-file') {
      await cacheModelFile(m.buffer);
      post({ type: 'model-cached' });
      return;
    }
    if (m.type === 'bench') {
      const sess = await getSession(status);
      status('Medindo a velocidade do aparelho…');
      post({ type: 'bench', seconds: await benchmark(sess) });
      return;
    }
    if (m.type === 'run') {
      aborter = new AbortController();
      const sess = await getSession(status);
      status('Separando…');
      const stems = await separate({
        left: m.left,
        right: m.right,
        model: makeModel(sess),
        targets: m.targets,
        overlap: m.overlap,
        onProgress: (frac) => post({ type: 'progress', frac }),
        signal: aborter.signal,
      });
      let report = null;
      if (m.restore && stems.voz) {
        status('Restaurando a voz…');
        const r = restoreVoice({ left: stems.voz[0], right: stems.voz[1] }, m.restore);
        stems.voz = [r.left, r.right];
        report = r.report;
      }
      const transfer = Object.values(stems).flatMap((pair) => pair.map((x) => x.buffer));
      post({ type: 'done', stems, report }, transfer);
    }
  } catch (err) {
    post({ type: 'error', name: err?.name ?? 'Error', message: err?.message ?? String(err) });
  }
};
