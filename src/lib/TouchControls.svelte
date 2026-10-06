<script>
  /**
   * On-screen controls for phones and tablets: a joystick on the left (steer and climb) and
   * buttons on the right. Each control tracks its own pointer, so several fingers work at once.
   */
  let { input, onpause, onchallenges } = $props();

  const RADIUS = 52;
  let knob = $state({ x: 0, y: 0 });
  let stickPointer = null;
  let centre = null;

  /** Keeps receiving a finger's moves even when it slides off the control (can fail for synthetic events). */
  function capture(e) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no active pointer to capture: the control still works while the finger stays on it
    }
  }

  function stickDown(e) {
    stickPointer = e.pointerId;
    const r = e.currentTarget.getBoundingClientRect();
    centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    capture(e);
    stickMove(e);
  }

  function stickMove(e) {
    if (e.pointerId !== stickPointer || !centre) return;
    let dx = e.clientX - centre.x, dy = e.clientY - centre.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx *= RADIUS / d;
      dy *= RADIUS / d;
    }
    knob = { x: dx, y: dy };
    input.setTouch({ turn: dx / RADIUS, climb: -dy / RADIUS });
  }

  function stickUp(e) {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    knob = { x: 0, y: 0 };
    input.setTouch({ turn: 0, climb: 0 });
  }

  /** Hold-to-act buttons (flap, dive). */
  const hold = (action) => ({
    onpointerdown: (e) => {
      capture(e);
      input.setTouch({ [action]: true });
    },
    onpointerup: () => input.setTouch({ [action]: false }),
    onpointercancel: () => input.setTouch({ [action]: false }),
  });
</script>

<div class="touch" aria-label="Touch controls">
  <div
    class="stick"
    role="slider"
    aria-label="Steer and climb"
    aria-valuenow={0}
    tabindex="-1"
    onpointerdown={stickDown}
    onpointermove={stickMove}
    onpointerup={stickUp}
    onpointercancel={stickUp}
  >
    <div class="knob" style="transform: translate({knob.x}px, {knob.y}px)"></div>
  </div>

  <div class="buttons">
    <button class="big flap" {...hold('flap')}>Flap</button>
    <button class="dive" {...hold('dive')}>Dive</button>
    <button class="land" onpointerdown={() => input.press('land')}>Land</button>
  </div>

  <div class="menu">
    <button onclick={onchallenges}>Challenges</button>
    <button onclick={onpause}>Menu</button>
  </div>
</div>

<style>
  .touch {
    position: absolute;
    inset: 0;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .stick,
  .buttons button,
  .menu button {
    pointer-events: auto;
    touch-action: none;
  }

  .stick {
    position: absolute;
    left: 20px;
    bottom: 56px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    border: 2px solid #ffffff66;
    background: #0d1a2740;
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
  }

  .knob {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #ffffffcc;
    box-shadow: 0 2px 10px #0006;
  }

  .buttons {
    position: absolute;
    right: 20px;
    bottom: 150px;
    display: grid;
    grid-template-columns: auto auto;
    gap: 12px;
    align-items: end;
  }

  .buttons button,
  .menu button {
    border: 2px solid #ffffff88;
    border-radius: 50%;
    background: #0d1a2766;
    color: #fff;
    font: inherit;
    font-weight: 700;
    backdrop-filter: blur(4px);
  }

  .buttons button {
    width: 68px;
    height: 68px;
  }

  .buttons .big {
    grid-row: span 2;
    width: 96px;
    height: 96px;
    background: #f0b42999;
  }

  .buttons button:active {
    background: #f0b429;
  }

  .menu {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 8px;
  }

  .menu button {
    border-radius: 999px;
    padding: 0.3rem 0.8rem;
    font-size: 0.8rem;
  }

  /* Phones held sideways: keep the controls low so they clear the top bar. */
  @media (max-height: 500px) {
    .stick {
      bottom: 24px;
    }

    .buttons {
      bottom: 34px;
    }
  }
</style>
