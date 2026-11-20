/**
 * Step-by-step tutorial controller: Back / Next / Play-Pause / Reset and a step counter.
 * It has no 3D code, so the lesson UI works before the 3D scene has loaded.
 */
export interface TutorialStep {
  title: string;
  /** Max 3 short sentences. */
  caption: string;
  /** Placard / part ids to highlight in this step. */
  focus: string[];
}

export interface TutorialHooks {
  onStep(index: number, step: TutorialStep): void;
  onPlayPause(playing: boolean): void;
  onReset(): void;
}

function byId<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export class Tutorial {
  index = 0;
  playing = true;
  private hooks: TutorialHooks | null = null;
  private readonly el = {
    counter: byId('step-counter'),
    title: byId('step-title'),
    caption: byId('step-caption'),
    back: byId<HTMLButtonElement>('btn-back'),
    next: byId<HTMLButtonElement>('btn-next'),
    play: byId<HTMLButtonElement>('btn-play'),
    reset: byId<HTMLButtonElement>('btn-reset'),
    dots: byId('step-dots'),
  };

  constructor(readonly steps: TutorialStep[]) {
    this.el.dots.innerHTML = '';
    steps.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step-dot';
      b.setAttribute('aria-label', `Go to step ${i + 1}: ${s.title}`);
      b.addEventListener('click', () => this.go(i));
      this.el.dots.appendChild(b);
    });
    this.el.back.addEventListener('click', () => this.go(this.index - 1));
    this.el.next.addEventListener('click', () => this.go(this.index + 1));
    this.el.play.addEventListener('click', () => this.setPlaying(!this.playing));
    this.el.reset.addEventListener('click', () => this.reset());
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') this.go(this.index + 1);
      else if (e.key === 'ArrowLeft') this.go(this.index - 1);
      else if (e.key === ' ' && !t.closest('button')) {
        e.preventDefault();
        this.setPlaying(!this.playing);
      }
    });
    this.render();
  }

  /** Connects the 3D lesson once it has loaded, and applies the current step. */
  connect(hooks: TutorialHooks) {
    this.hooks = hooks;
    hooks.onPlayPause(this.playing);
    hooks.onStep(this.index, this.steps[this.index]);
  }

  go(i: number) {
    if (i < 0 || i >= this.steps.length) return;
    this.index = i;
    this.render();
    this.hooks?.onStep(i, this.steps[i]);
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    this.render();
    this.hooks?.onPlayPause(playing);
  }

  reset() {
    this.index = 0;
    this.playing = true;
    this.render();
    this.hooks?.onReset();
    this.hooks?.onPlayPause(true);
    this.hooks?.onStep(0, this.steps[0]);
  }

  private render() {
    const s = this.steps[this.index];
    this.el.counter.textContent = `Step ${this.index + 1} of ${this.steps.length}`;
    this.el.title.textContent = s.title;
    this.el.caption.innerHTML = s.caption;
    this.el.back.disabled = this.index === 0;
    this.el.next.disabled = this.index === this.steps.length - 1;
    this.el.play.textContent = this.playing ? 'Pause' : 'Play';
    this.el.play.setAttribute('aria-pressed', String(!this.playing));
    [...this.el.dots.children].forEach((d, i) => {
      d.classList.toggle('is-current', i === this.index);
      d.classList.toggle('is-done', i < this.index);
    });
  }
}
