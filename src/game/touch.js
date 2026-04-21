export function initTouchControls(player) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

  const tc = document.getElementById('touch-controls');
  if (tc) tc.style.display = 'block';

  const zone  = document.getElementById('joystick-zone');
  const knob  = document.getElementById('joystick-knob');
  const RADIUS = 40;
  let joystickId = null;
  let joystickOrigin = { x: 0, y: 0 };

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joystickId = t.identifier;
    const r = zone.getBoundingClientRect();
    joystickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
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
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.4) continue;
      if (lookId !== null) continue;
      lookId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
    }
  });

  document.addEventListener('touchmove', (e) => {
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

  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) lookId = null;
    }
  });

  const btnJump  = document.getElementById('btn-jump');
  const btnBreak = document.getElementById('btn-break');
  const btnPlace = document.getElementById('btn-place');

  btnJump.addEventListener('touchstart',  (e) => { e.preventDefault(); player.touchJump = true;  }, { passive: false });
  btnJump.addEventListener('touchend',    (e) => { e.preventDefault(); player.touchJump = false; }, { passive: false });
  btnBreak.addEventListener('touchstart', (e) => { e.preventDefault(); player.touchBreak = true;  }, { passive: false });
  btnBreak.addEventListener('touchend',   (e) => { e.preventDefault(); player.touchBreak = false; }, { passive: false });
  btnPlace.addEventListener('touchstart', (e) => { e.preventDefault(); player.touchPlace = true;  player._placing = true;  }, { passive: false });
  btnPlace.addEventListener('touchend',   (e) => { e.preventDefault(); player.touchPlace = false; player._placing = false; }, { passive: false });
}
