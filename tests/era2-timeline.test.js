import { describe, expect, it } from 'vitest';
import {
  LATEST_TRANSITION_MS,
  MEMORY_HOLD_MS,
  formatDuration,
  latestFrame,
  memoryDuration,
  memoryFrame
} from '../public/era2/timeline.mjs';

describe('Era II playback timeline', () => {
  it('plays the latest transition once over 18 seconds', () => {
    expect(LATEST_TRANSITION_MS).toBe(18_000);
    expect(latestFrame(0)).toEqual({ progress: 0, complete: false });
    expect(latestFrame(9_000)).toEqual({ progress: 0.5, complete: false });
    expect(latestFrame(18_000)).toEqual({ progress: 1, complete: true });
    expect(latestFrame(90_000)).toEqual({ progress: 1, complete: true });
  });

  it('skips motion when reduced motion is requested', () => {
    expect(latestFrame(0, true)).toEqual({ progress: 1, complete: true });
  });

  it('calculates and formats the complete memory runtime', () => {
    expect(MEMORY_HOLD_MS).toBe(4_000);
    expect(memoryDuration(3)).toBe(66_000);
    expect(formatDuration(memoryDuration(3))).toBe('1:06');
    expect(formatDuration(memoryDuration(200))).toBe('1:13:20');
  });

  it('plays memory chronologically with a hold after each epoch', () => {
    expect(memoryFrame(0, 3)).toMatchObject({ epochIndex: 0, progress: 0, holding: false });
    expect(memoryFrame(9_000, 3)).toMatchObject({ epochIndex: 0, progress: 0.5, holding: false });
    expect(memoryFrame(18_000, 3)).toMatchObject({ epochIndex: 0, progress: 1, holding: true });
    expect(memoryFrame(22_000, 3)).toMatchObject({ epochIndex: 1, progress: 0, holding: false });
    expect(memoryFrame(66_000, 3)).toEqual({
      epochIndex: 2,
      progress: 1,
      holding: false,
      complete: true
    });
  });
});
