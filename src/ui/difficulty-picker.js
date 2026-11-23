// Seletor de dificuldade (tela inicial e menu de pausa).
import { DIFFICULTIES, loadDifficultyId, saveDifficultyId } from '../core/difficulty.js?v=1';

export function initDifficultyPickers(root = document) {
  const pickers = [...root.querySelectorAll('[data-difficulty-picker]')];
  const render = (id) => {
    for (const p of pickers) {
      for (const btn of p.querySelectorAll('[data-diff]')) {
        const on = btn.dataset.diff === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        btn.setAttribute('role', 'radio');
      }
      const desc = p.querySelector('.difficulty-desc');
      if (desc) desc.textContent = DIFFICULTIES[id]?.desc || '';
    }
  };
  for (const p of pickers) {
    p.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-diff]');
      if (!btn) return;
      const id = btn.dataset.diff;
      saveDifficultyId(id);
      render(id);
      window.dispatchEvent(new CustomEvent('gta-difficulty', { detail: { id } }));
    });
  }
  render(loadDifficultyId());
}
