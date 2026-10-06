const BINDINGS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'flap',
  ShiftLeft: 'dive', ShiftRight: 'dive',
  KeyE: 'land',
};

// Actions that trigger once per key press rather than while held.
const PRESS_ACTIONS = new Set(['land']);

// Standard gamepad layout (Xbox naming): A flap, B land, Y challenges, Start pause, right trigger dive.
const PAD = { flap: 0, land: 1, challenges: 3, dive: 7, pause: 9 };
const DEADZONE = 0.15;

const clamp = (v) => Math.max(-1, Math.min(1, v));

/**
 * Flight controls from the keyboard, a gamepad and on-screen touch controls, merged into one state.
 * Read `state` once per frame: it consumes one-shot presses and polls the gamepad.
 * Gamepad buttons that open menus are reported through `onButton(name)`.
 */
export class Input {
  constructor(target = window) {
    this.target = target;
    this.held = new Set();
    this.pressed = new Set();
    this.touch = { turn: 0, climb: 0, flap: false, dive: false };
    this.invertClimb = false;
    this.onButton = () => {};
    this.padButtons = [];
    this.gamepadConnected = false;

    this.onKeyDown = (e) => {
      const action = BINDINGS[e.code];
      if (!action || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (PRESS_ACTIONS.has(action)) {
        if (!e.repeat) this.pressed.add(action);
      } else {
        this.held.add(action);
      }
      e.preventDefault();
    };
    this.onKeyUp = (e) => {
      const action = BINDINGS[e.code];
      if (action) this.held.delete(action);
    };
    this.onBlur = () => {
      this.held.clear();
      this.setTouch({ turn: 0, climb: 0, flap: false, dive: false });
    };

    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Updates the on-screen controls' contribution (any subset of turn, climb, flap, dive). */
  setTouch(values) {
    Object.assign(this.touch, values);
  }

  /** A one-shot action from a button on screen (e.g. 'land'). */
  press(action) {
    this.pressed.add(action);
  }

  /** Reads the first connected gamepad: sticks and held buttons, plus edges for one-shot buttons. */
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p?.connected);
    this.gamepadConnected = !!pad;
    if (!pad) return { turn: 0, climb: 0, flap: false, dive: false };

    const down = (i) => !!(pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5);
    const edge = (i) => down(i) && !this.padButtons[i];
    if (edge(PAD.land)) this.pressed.add('land');
    if (edge(PAD.pause)) this.onButton('pause');
    if (edge(PAD.challenges)) this.onButton('challenges');
    this.padButtons = pad.buttons.map((b) => b.pressed || b.value > 0.5);

    const axis = (i) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
    };
    return { turn: axis(0), climb: -axis(1), flap: down(PAD.flap), dive: down(PAD.dive) };
  }

  get state() {
    const h = this.held;
    const pad = this.pollGamepad();
    const climb = clamp((h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0) + this.touch.climb + pad.climb);
    const state = {
      turn: clamp((h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0) + this.touch.turn + pad.turn),
      climb: this.invertClimb ? -climb : climb,
      flap: h.has('flap') || this.touch.flap || pad.flap,
      dive: h.has('dive') || this.touch.dive || pad.dive,
      land: this.pressed.has('land'),
    };
    this.pressed.clear();
    return state;
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
