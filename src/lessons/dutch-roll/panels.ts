/**
 * Cockpit insets drawn in SVG (no 3D code).
 *
 * 1) Overhead panel — FLT CTL section with ELAC 1, SEC 1 and FAC 1 pushbuttons.
 *    Layout note: modelled on the public description of the A320 overhead FLT CTL panel
 *    (FCOM DSC-27, "Controls and indicators"): FAC 1 is on the captain-side FLT CTL panel
 *    next to ELAC 1 and SEC 1. The FAC pushbutton has two lights: "FAULT" (amber, upper)
 *    and "OFF" (white, lower). Pushbutton IN = ON (no light); OUT = OFF (white OFF light).
 *    TEACHING SIMPLIFICATIONS: (a) on the real aircraft the yaw damper is one function of
 *    the FAC and FAC 2 is a back-up, so pressing FAC 1 OFF alone does not remove yaw
 *    damping; here FAC 1 is treated as "the yaw damper". (b) A green "ON" status text is
 *    added under the button for students; it is not an aircraft light.
 *    Please check against the current A320 FCOM before using for type training.
 *
 * 2) Rudder position indicator — similar in idea to the rudder display on the ECAM F/CTL
 *    page (green rudder symbol on a scale under the tail). Layout simplified.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RAD = 180 / Math.PI;

export interface OverheadPanel {
  set(on: boolean, animate?: boolean): void;
}

export function createOverheadPanel(host: HTMLElement, onToggle: () => void): OverheadPanel {
  host.innerHTML = `
    <div class="ovh" role="group" aria-label="Overhead panel, flight controls">
      <div class="ovh-title">FLT CTL</div>
      <div class="ovh-row">
        <div class="pb pb-static" aria-hidden="true"><span class="pb-fault">FAULT</span><span class="pb-off">OFF</span><span class="pb-name">ELAC 1</span></div>
        <div class="pb pb-static" aria-hidden="true"><span class="pb-fault">FAULT</span><span class="pb-off">OFF</span><span class="pb-name">SEC 1</span></div>
        <button type="button" class="pb pb-live" id="pb-fac" aria-pressed="false">
          <span class="pb-fault">FAULT</span><span class="pb-off">OFF</span><span class="pb-name">FAC 1</span>
        </button>
      </div>
      <div class="ovh-status">Yaw damper <b id="yd-status">OFF</b></div>
    </div>`;
  const btn = host.querySelector<HTMLButtonElement>('#pb-fac')!;
  const status = host.querySelector<HTMLElement>('#yd-status')!;
  btn.addEventListener('click', () => onToggle());
  return {
    set(on, animate = true) {
      if (animate) {
        btn.classList.remove('is-pressing');
        void btn.offsetWidth; // restart the CSS animation
        btn.classList.add('is-pressing');
      }
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `FAC 1 yaw damper pushbutton, ${on ? 'ON' : 'OFF'}`);
      btn.classList.toggle('is-on', on);
      status.textContent = on ? 'ON' : 'OFF';
      status.dataset.on = String(on);
    },
  };
}

export interface RudderIndicator {
  set(rudderRad: number, limitRad: number): void;
}

export function createRudderIndicator(host: HTMLElement): RudderIndicator {
  const W = 150;
  const H = 104;
  const cx = W / 2;
  const cy = 14;
  const R = 70;
  const SPAN = 50; // ± display angle in degrees for ± travel limit
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy + r * Math.cos(a)];
  };
  const ticks = [-1, -0.5, 0, 0.5, 1]
    .map((f) => {
      const [x1, y1] = pt(f * SPAN, R - (f === 0 ? 8 : 5));
      const [x2, y2] = pt(f * SPAN, R);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
    })
    .join('');
  const [ax, ay] = pt(-SPAN, R);
  const [bx, by] = pt(SPAN, R);
  host.innerHTML = `
    <div class="ecam" role="img" aria-label="Rudder position indicator">
      <svg viewBox="0 0 ${W} ${H}" xmlns="${SVG_NS}">
        <text x="6" y="12" class="ecam-title">F/CTL</text>
        <text x="${W - 6}" y="12" class="ecam-title" text-anchor="end">RUD</text>
        <path d="M ${bx} ${by} A ${R} ${R} 0 0 1 ${ax} ${ay}" class="ecam-arc" />
        <g class="ecam-ticks">${ticks}</g>
        <g class="ecam-limit">
          <path d="M ${pt(-SPAN, R + 2).join(' ')} L ${pt(-SPAN - 4, R + 9).join(' ')} L ${pt(-SPAN + 3, R + 9).join(' ')} Z" />
          <path d="M ${pt(SPAN, R + 2).join(' ')} L ${pt(SPAN + 4, R + 9).join(' ')} L ${pt(SPAN - 3, R + 9).join(' ')} Z" />
        </g>
        <g id="ecam-rudder" class="ecam-rudder">
          <path d="M ${cx - 3} ${cy + 4} L ${cx + 3} ${cy + 4} L ${cx + 1.2} ${cy + R - 4} L ${cx - 1.2} ${cy + R - 4} Z" />
        </g>
        <text x="${cx}" y="${H - 3}" class="ecam-value" text-anchor="middle" id="ecam-value">0.0°</text>
        <text x="8" y="${H - 3}" class="ecam-side">L</text>
        <text x="${W - 8}" y="${H - 3}" class="ecam-side" text-anchor="end">R</text>
      </svg>
    </div>`;
  const rudder = host.querySelector<SVGGElement>('#ecam-rudder')!;
  const value = host.querySelector<SVGTextElement>('#ecam-value')!;
  let last = '';
  return {
    set(rad, limit) {
      // + = trailing edge right → symbol moves right (seen from behind, like the ECAM)
      const f = Math.max(-1, Math.min(1, rad / limit));
      rudder.setAttribute('transform', `rotate(${(-f * SPAN).toFixed(2)} ${cx} ${cy})`);
      const deg = rad * RAD;
      const txt = Math.abs(deg) < 0.05 ? '0.0°' : `${Math.abs(deg).toFixed(1)}° ${deg > 0 ? 'R' : 'L'}`;
      if (txt !== last) value.textContent = last = txt;
    },
  };
}
