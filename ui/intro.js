// Abertura cinematográfica obrigatória e curta (≈ 7 s; ≈ 2,6 s com animações reduzidas): a câmera
// atravessa o mapa até o operador do menu enquanto o símbolo e o logotipo se formam, e mostra o
// carregamento dos personagens. Não há botão nem tecla para pular. Nunca trava: o fim acontece por
// tempo ou, se os modelos demorarem, após um limite de espera.

const TIMELINE = { phase2: 2.3, phase3: 5.4, end: 6.9 };
const REDUCED_END = 2.6;
const MAX_WAIT_LOADING = 14;     // segundos extras aguardando os modelos antes de seguir sem eles
const CAPTIONS = [
  [0.4, 'TERMINAL 4 · INSTALAÇÃO FOUNDRY-7'],
  [2.6, 'CADA RODADA COMEÇA DO ZERO'],
];

export class Intro {
  constructor(game) {
    this.game = game;
    this.screen = document.querySelector('[data-screen="intro"]');
    this.caption = document.getElementById('intro-caption');
    this.loadBar = document.getElementById('intro-load-bar');
    this.loadText = document.getElementById('intro-load-text');
    this.running = false;
  }

  /**
   * Executa a abertura. `loading` = promessa dos modelos; `progress()` → { loaded, total }.
   * Resolve quando a abertura termina.
   */
  play({ reduced, loading, progress }) {
    this.running = true;
    this.reduced = reduced;
    this.t = 0;
    this.phase = 0;
    this.captionIdx = -1;
    this.loadingDone = false;
    this.progress = progress;
    loading.then(() => { this.loadingDone = true; }, () => { this.loadingDone = true; });
    this.screen.classList.remove('phase-1', 'phase-2', 'phase-3', 'ending');
    this.screen.classList.toggle('reduced', reduced);
    this.game.ui.showScreen('intro');
    this.game.audio.play('introHit');
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  /** Avança a abertura (chamado pelo loop do jogo). Retorna o progresso da câmera 0–1. */
  update(dt) {
    if (!this.running) return 1;
    this.t += dt;
    const t = this.t;
    const end = this.reduced ? REDUCED_END : TIMELINE.end;
    if (this.phase < 1) this.setPhase(1);
    if (this.phase < 2 && t >= (this.reduced ? 0.6 : TIMELINE.phase2)) this.setPhase(2);
    if (this.phase < 3 && t >= (this.reduced ? REDUCED_END - 0.6 : TIMELINE.phase3)) {
      // só encerra o letreiro quando os modelos estiverem prontos (ou o limite de espera passar)
      if (this.loadingDone || t >= end + MAX_WAIT_LOADING) this.setPhase(3);
    }
    for (let i = this.captionIdx + 1; i < CAPTIONS.length; i++) {
      if (t >= CAPTIONS[i][0] * (this.reduced ? 0.25 : 1)) { this.captionIdx = i; this.caption.textContent = CAPTIONS[i][1]; }
    }
    const p = this.progress();
    const frac = p.total ? p.loaded / p.total : 0;
    this.loadBar.style.transform = `scaleX(${this.loadingDone ? 1 : frac.toFixed(3)})`;
    this.loadText.textContent = this.loadingDone ? 'Operadores prontos' : `Carregando operadores e animações… ${p.loaded}/${p.total || '—'}`;
    if (this.phase === 3 && t >= this.phase3At + (this.reduced ? 0.6 : TIMELINE.end - TIMELINE.phase3)) this.finish();
    // a câmera avança até o enquadramento final; se os modelos atrasarem, ela espera no fim
    return Math.min(1, t / end);
  }

  setPhase(n) {
    this.phase = n;
    this.screen.classList.add(`phase-${n}`);
    if (n === 3) { this.phase3At = this.t; this.screen.classList.add('ending'); }
  }

  finish() {
    if (!this.running) return;
    this.running = false;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }
}
