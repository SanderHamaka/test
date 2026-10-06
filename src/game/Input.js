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

/** Keyboard state for flight controls. Read `state` once per frame: it consumes one-shot presses. */
export class Input {
  constructor(target = window) {
    this.target = target;
    this.held = new Set();
    this.pressed = new Set();
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
    this.onBlur = () => this.held.clear();

    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  get state() {
    const h = this.held;
    const state = {
      turn: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0),
      climb: (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0),
      flap: h.has('flap'),
      dive: h.has('dive'),
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
