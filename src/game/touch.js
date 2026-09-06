export function initTouchControls(player) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

  const tc = document.getElementById('touch-controls');
  if (tc) { tc.style.display = 'block'; tc.hidden = true; }

  const zone  = document.getElementById('joystick-zone');
  const knob  = document.getElementById('joystick-knob');
  const RADIUS = 40;
  let joystickId = null;
  let joystickOrigin = { x: 0, y: 0 };

  zone.addEventListener('touchstart', (e) => {
    if (!player.active) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    joystickId = t.identifier;
    const r = zone.getBoundingClientRect();
    joystickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    if (!player.active) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickId) continue;
      let dx = t.clientX - joystickOrigin.x;
      let dy = t.clientY - joystickOrigin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) { dx = dx / dist * RADIUS; dy = dy / dist * RADIUS; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      player.touchMove.x =  dx / RADIUS;
      player.touchMove.z =  dy / RADIUS;
    }
  }, { passive: false });

  const endJoystick = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joystickId) continue;
      joystickId = null;
      knob.style.transform = 'translate(-50%, -50%)';
      player.touchMove.x = 0;
      player.touchMove.z = 0;
    }
  };
  zone.addEventListener('touchend',    endJoystick);
  zone.addEventListener('touchcancel', endJoystick);

  let lookId = null;
  let lastLook = { x: 0, y: 0 };

  document.addEventListener('touchstart', (e) => {
    if (!player.active || e.target !== document.getElementById('canvas')) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.4) continue;
      if (lookId !== null) continue;
      lookId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
    }
  });

  document.addEventListener('touchmove', (e) => {
    if (!player.active || lookId === null) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      const dx = t.clientX - lastLook.x;
      const dy = t.clientY - lastLook.y;
      player._yaw   -= dx * 0.004;
      player._pitch -= dy * 0.004;
      const HALF_PI = Math.PI / 2 - 0.01;
      player._pitch  = Math.max(-HALF_PI, Math.min(HALF_PI, player._pitch));
      lastLook = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });

  const endLook = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) lookId = null;
    }
  };
  document.addEventListener('touchend', endLook);
  document.addEventListener('touchcancel', endLook);

  const btnJump  = document.getElementById('btn-jump');
  const btnBreak = document.getElementById('btn-break');
  const btnPlace = document.getElementById('btn-place');

  btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault(); if (player.active) player.touchJump = true;
  }, { passive: false });
  for (const event of ['touchend', 'touchcancel']) {
    btnJump.addEventListener(event, (e) => { e.preventDefault(); player.touchJump = false; }, { passive: false });
  }
  for (const [button, kind] of [[btnBreak, 'break'], [btnPlace, 'place']]) {
    button.addEventListener('touchstart', (e) => {
      e.preventDefault(); player.beginInteraction(kind, true);
    }, { passive: false });
    for (const event of ['touchend', 'touchcancel']) {
      button.addEventListener(event, (e) => {
        e.preventDefault(); player.endInteraction(kind, true);
        if (event === 'touchcancel') {
          if (kind === 'break') player._breakQueued = false;
          else player._placeQueued = 0;
        }
      }, { passive: false });
    }
  }
}
