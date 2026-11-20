/** Small helpers that bind HTML sliders, switches and segmented buttons. No 3D code. */

export interface Range {
  min: number;
  max: number;
  step: number;
  default: number;
}

export function bindSlider(
  inputId: string,
  outputId: string,
  range: Range,
  format: (v: number) => string,
  onInput: (v: number) => void,
  /** Called once when the user lets go of the slider (or finishes a keyboard change). */
  onCommit?: (v: number) => void,
) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const output = document.getElementById(outputId) as HTMLOutputElement;
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  const paint = () => {
    const t = (Number(input.value) - range.min) / (range.max - range.min);
    input.style.setProperty('--fill', `${(t * 100).toFixed(1)}%`);
    output.textContent = format(Number(input.value));
  };
  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });
  if (onCommit) input.addEventListener('change', () => onCommit(Number(input.value)));
  return {
    set(v: number) {
      input.value = String(v);
      paint();
    },
  };
}

export function bindSwitch(id: string, onChange: (on: boolean) => void) {
  const el = document.getElementById(id) as HTMLButtonElement;
  const label = el.querySelector('span')!;
  let on = el.getAttribute('aria-checked') === 'true';
  el.addEventListener('click', () => onChange(!on));
  return {
    set(v: boolean) {
      on = v;
      el.setAttribute('aria-checked', String(v));
      label.textContent = v ? 'ON' : 'OFF';
    },
  };
}

export function bindSegmented(selector: string, dataKey: string, onChange: (value: string) => void) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(selector)];
  buttons.forEach((b) => b.addEventListener('click', () => onChange(b.dataset[dataKey]!)));
  return {
    set(value: string) {
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset[dataKey] === value)));
    },
  };
}
