const { PALETTE } = require('./constants');

/**
 * Process color into substrate-compatible tone
 * Agent's intent comes through but everything belongs on the surface
 */
function snapToPalette(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return PALETTE[0];
  
  let r = parseInt(hex.slice(1, 3), 16) || 0;
  let g = parseInt(hex.slice(3, 5), 16) || 0;
  let b = parseInt(hex.slice(5, 7), 16) || 0;
  
  // Convert to HSL for manipulation
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h, s, l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  
  // Substrate processing:
  // 1. Cap saturation — tame neons but keep character (max 70%)
  s = Math.min(s, 0.70);
  // 2. Light desaturation (pull 10% toward gray — gentle)
  s *= 0.9;
  // 3. Constrain lightness — no pure white or pure black
  //    Range: 0.25 (dark metal) to 0.65 (bright copper)
  l = Math.max(0.25, Math.min(0.65, l));
  // 4. Very slight warm shift — nudge hue 2% toward orange
  const warmTarget = 0.08;
  h = h + (warmTarget - h) * 0.03;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  
  // Convert back to RGB
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  
  let ro, go, bo;
  if (s === 0) {
    ro = go = bo = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    ro = hue2rgb(p, q, h + 1/3);
    go = hue2rgb(p, q, h);
    bo = hue2rgb(p, q, h - 1/3);
  }
  
  const rHex = Math.round(ro * 255).toString(16).padStart(2, '0');
  const gHex = Math.round(go * 255).toString(16).padStart(2, '0');
  const bHex = Math.round(bo * 255).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}

module.exports = { snapToPalette, PALETTE };
