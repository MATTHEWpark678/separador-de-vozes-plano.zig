import { h, button, progressBar } from './dom.js';

/**
 * Tela de espera com barra e botão Cancelar.
 * start({set, status}) deve devolver uma Promise (com .cancel opcional).
 */
export function progressScreen({ title, start, onDone, onCancel, onFail }) {
  const bar = progressBar();
  bar.set(null, 'Começando…');
  const msg = h('p', { class: 'help', role: 'status' }, 'Pode deixar a tela ligada. Não feche o app.');
  const errBox = h('div', { class: 'error-box', role: 'alert', hidden: true });
  let job = null;
  let cancelled = false;

  const cancelBtn = button('Cancelar', { variant: 'secondary', onClick: () => { cancelled = true; job?.cancel?.(); onCancel?.(); } });
  const el = h('main', { class: 'screen' }, h('h1', { tabindex: '-1' }, title), bar.el, msg, errBox, h('div', { class: 'row' }, cancelBtn));

  let wake = null;
  (async () => {
    try {
      wake = await navigator.wakeLock?.request?.('screen');
    } catch {
      // tudo bem sem isso
    }
    try {
      job = start({
        set: (frac, label) => bar.set(frac, label),
        status: (t) => {
          msg.textContent = t;
          if (/Baixando|Carregando|Preparando|Medindo/.test(t)) bar.set(null, t);
        },
      });
      const result = await job;
      if (!cancelled) onDone(result);
    } catch (err) {
      if (cancelled || err?.name === 'AbortError') return;
      errBox.hidden = false;
      errBox.textContent = err?.message ?? String(err);
      cancelBtn.querySelector('span').textContent = 'Voltar';
      onFail?.(err);
    }
  })();

  return { el, leave: () => wake?.release?.().catch?.(() => {}) };
}
