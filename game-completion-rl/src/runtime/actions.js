const VALID_CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];

function emptyAction() {
  return {
    type: 'noop',
    controls: {},
    look: null,
    hotbarSlot: null,
    useItem: false,
    attack: false,
    dig: false
  };
}

function normalizeAction(action) {
  const raw = action && typeof action === 'object' ? action : {};
  const out = { ...emptyAction(), ...raw };
  out.controls = out.controls && typeof out.controls === 'object' ? out.controls : {};
  for (const key of Object.keys(out.controls)) {
    if (!VALID_CONTROLS.includes(key)) delete out.controls[key];
    else out.controls[key] = !!out.controls[key];
  }
  if (out.look && typeof out.look !== 'object') out.look = null;
  if (out.look) {
    out.look = {
      yawDelta: finiteNumber(out.look.yawDelta, 0),
      pitchDelta: finiteNumber(out.look.pitchDelta, 0)
    };
  }
  out.useItem = !!out.useItem;
  out.attack = !!out.attack;
  out.dig = !!out.dig;
  return out;
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = { VALID_CONTROLS, emptyAction, normalizeAction };
