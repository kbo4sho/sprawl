import { describe, it, expect } from 'vitest';

// Extract the color processing logic from server.js for testing
function snapToPalette(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return '#fff8f0';
  
  let r = parseInt(hex.slice(1, 3), 16) || 0;
  let g = parseInt(hex.slice(3, 5), 16) || 0;
  let b = parseInt(hex.slice(5, 7), 16) || 0;
  
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
  
  s = Math.min(s, 0.70);
  s *= 0.9;
  l = Math.max(0.25, Math.min(0.65, l));
  const warmTarget = 0.08;
  h = h + (warmTarget - h) * 0.03;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  
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

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function getLightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / (2 * 255);
}

function getSaturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r/255, gn = g/255, bn = b/255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

describe('Color Processing', () => {
  describe('invalid inputs', () => {
    it('returns default for null', () => {
      expect(snapToPalette(null)).toBe('#fff8f0');
    });

    it('returns default for empty string', () => {
      expect(snapToPalette('')).toBe('#fff8f0');
    });

    it('returns default for non-hex string', () => {
      expect(snapToPalette('red')).toBe('#fff8f0');
    });

    it('returns default for short hex', () => {
      expect(snapToPalette('#fff')).toBe('#fff8f0');
    });
  });

  describe('saturation capping', () => {
    it('tames neon red', () => {
      const result = snapToPalette('#ff0000');
      expect(getSaturation(result)).toBeLessThanOrEqual(0.65);
    });

    it('tames neon green', () => {
      const result = snapToPalette('#00ff00');
      expect(getSaturation(result)).toBeLessThanOrEqual(0.65);
    });

    it('tames hot pink', () => {
      const result = snapToPalette('#ff00ff');
      expect(getSaturation(result)).toBeLessThanOrEqual(0.65);
    });
  });

  describe('lightness constraints', () => {
    it('prevents pure white', () => {
      const result = snapToPalette('#ffffff');
      expect(getLightness(result)).toBeLessThanOrEqual(0.66);
    });

    it('prevents pure black', () => {
      const result = snapToPalette('#000000');
      expect(getLightness(result)).toBeGreaterThanOrEqual(0.24);
    });

    it('keeps mid-range colors in range', () => {
      const result = snapToPalette('#8b6914');
      const l = getLightness(result);
      expect(l).toBeGreaterThanOrEqual(0.2);
      expect(l).toBeLessThanOrEqual(0.7);
    });
  });

  describe('hue preservation', () => {
    it('red input stays warm', () => {
      const { r, b } = hexToRgb(snapToPalette('#ff0000'));
      expect(r).toBeGreaterThan(b);
    });

    it('blue input stays cool', () => {
      const { r, b } = hexToRgb(snapToPalette('#0000ff'));
      expect(b).toBeGreaterThan(r);
    });

    it('green input stays green', () => {
      const { g, r, b } = hexToRgb(snapToPalette('#00ff00'));
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    });
  });

  describe('output format', () => {
    it('returns 7-char hex string', () => {
      const result = snapToPalette('#ff6b35');
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('handles all valid colors without error', () => {
      const colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffff00', '#00ffff', '#c45c3a', '#4a8ecc'];
      for (const c of colors) {
        const result = snapToPalette(c);
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });
});
