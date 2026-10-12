// Pequenos blocos de interface, sem biblioteca.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  if (value !== undefined) el.value = value;
  return el;
}

// Ícones desenhados do zero (traço simples, 24x24).
const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M15 5l-7 7 7 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  stop: 'M7 7h10v10H7z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M18 14.5c1.8.8 3 2.6 3 5.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  import: 'M12 15V4M7 9l5-5 5 5M5 20h14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1a7 7 0 0 0-2-1l-.5-2h-4L10 7a7 7 0 0 0-2 1L6 7l-2 4 2 1v2l-2 1 2 4 2-1a7 7 0 0 0 2 1l.5 2h4l.5-2a7 7 0 0 0 2-1l2 1 2-4-2-1z',
};

export function icon(name, size = 24) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', PATHS[name] ?? '');
  const filled = name === 'play' || name === 'pause' || name === 'stop';
  p.setAttribute('fill', filled ? 'currentColor' : 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1:12" ou "72" ou "1:02:03" -> segundos; devolve null se não entender. */
export function parseTime(text) {
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function fmtBytes(b) {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(b / 1048576))} MB`;
}

let toastTimer = 0;
export function toast(message, ms = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Folha que sobe de baixo. Foco entra nela, Esc fecha, foco volta ao botão de origem. */
export function sheet({ title, children, onClose }) {
  const origin = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, h('h2', {}, title), children);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    origin?.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  document.addEventListener('keydown', onKey);
  overlay.append(panel);
  document.body.append(overlay);
  (panel.querySelector('button, input') ?? panel).focus();
  return { close, panel };
}

export function button(label, { variant = 'secondary', onClick, icon: ic, disabled, busy, ariaLabel, pressed } = {}) {
  return h(
    'button',
    {
      class: `btn ${variant}`,
      type: 'button',
      onclick: onClick,
      disabled,
      'aria-busy': busy ? 'true' : null,
      'aria-label': ariaLabel,
      'aria-pressed': pressed == null ? null : String(pressed),
    },
    ic ? icon(ic, 20) : null,
    label ? h('span', {}, label) : null,
  );
}

/** Controle segmentado (radiogroup). options: [{value,label}] */
export function segmented({ name, label, options, value, onChange }) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const radios = options.map((o) => {
    const r = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1', 'data-v': o.value, class: 'seg' }, o.label);
    return r;
  });
  const select = (v) => {
    radios.forEach((r) => {
      const on = r.dataset.v === v;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    });
    onChange(v);
  };
  radios.forEach((r, i) => {
    r.addEventListener('click', () => select(r.dataset.v));
    r.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = radios[(i + (e.key === 'ArrowRight' ? 1 : radios.length - 1)) % radios.length];
        next.focus();
        select(next.dataset.v);
        e.preventDefault();
      }
    });
  });
  group.append(...radios);
  return group;
}

export function toggle({ id, label, help, checked, onChange }) {
  const helpId = `${id}-help`;
  const sw = h('button', { type: 'button', role: 'switch', id, 'aria-checked': String(!!checked), 'aria-describedby': helpId, class: 'switch' }, h('span', { class: 'knob' }));
  sw.addEventListener('click', () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  return h('div', { class: 'toggle-row' }, h('div', { class: 'toggle-text' }, h('label', { for: id }, label), h('p', { class: 'help', id: helpId }, help)), sw);
}

export function progressBar() {
  const fill = h('div', { class: 'fill' });
  const text = h('p', { class: 'progress-text' }, '');
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  return {
    el: h('div', {}, bar, text),
    set(frac, label) {
      const pct = frac == null ? null : Math.round(frac * 100);
      if (pct == null) {
        bar.removeAttribute('aria-valuenow');
        bar.classList.add('indeterminate');
      } else {
        bar.classList.remove('indeterminate');
        bar.setAttribute('aria-valuenow', String(pct));
        fill.style.width = `${pct}%`;
      }
      text.textContent = label ?? (pct == null ? '' : `${pct}%`);
    },
  };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
