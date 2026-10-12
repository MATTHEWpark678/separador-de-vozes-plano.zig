import { state, setRenderer, go } from './state.js';
import { libraryScreen } from './screen-library.js';
import { modeScreen, previewScreen } from './screen-mode.js';
import { playerScreen } from './screen-player.js';
import { voicesScreen } from './screen-voices.js';
import { karaokeScreen } from './screen-karaoke.js';
import { exportScreen } from './screen-export.js';

const root = document.getElementById('app');
let current = null;

const ctx = {
  // mostra uma tela avulsa (as de progresso), sem mudar a rota
  show(screen) {
    current?.leave?.();
    current = screen;
    root.replaceChildren(screen.el);
    window.scrollTo(0, 0);
    screen.el.querySelector('h1')?.focus?.();
  },
};

const screens = {
  library: libraryScreen,
  mode: modeScreen,
  preview: previewScreen,
  player: playerScreen,
  voices: voicesScreen,
  karaoke: karaokeScreen,
  export: exportScreen,
};

setRenderer(() => {
  const make = screens[state.screen] ?? libraryScreen;
  ctx.show(make(ctx));
});

window.addEventListener('beforeunload', (e) => {
  if (state.song && !state.song.meta.saved) {
    e.preventDefault();
    e.returnValue = '';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
go('library');
