export const LATEST_TRANSITION_MS = 18_000;
export const MEMORY_HOLD_MS = 4_000;

export function memoryDuration(epochCount) {
  if (!Number.isInteger(epochCount) || epochCount < 0) {
    throw new TypeError('Epoch count must be a non-negative integer');
  }
  return epochCount * (LATEST_TRANSITION_MS + MEMORY_HOLD_MS);
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function latestFrame(elapsedMilliseconds, reducedMotion = false) {
  const elapsed = Math.max(0, elapsedMilliseconds);
  if (reducedMotion || elapsed >= LATEST_TRANSITION_MS) {
    return { progress: 1, complete: true };
  }
  return {
    progress: elapsed / LATEST_TRANSITION_MS,
    complete: false
  };
}

export function memoryFrame(elapsedMilliseconds, epochCount) {
  const totalDuration = memoryDuration(epochCount);
  if (epochCount === 0) {
    return { epochIndex: -1, progress: 1, holding: false, complete: true };
  }

  const elapsed = Math.max(0, elapsedMilliseconds);
  if (elapsed >= totalDuration) {
    return {
      epochIndex: epochCount - 1,
      progress: 1,
      holding: false,
      complete: true
    };
  }

  const segmentDuration = LATEST_TRANSITION_MS + MEMORY_HOLD_MS;
  const epochIndex = Math.floor(elapsed / segmentDuration);
  const segmentElapsed = elapsed - epochIndex * segmentDuration;
  const holding = segmentElapsed >= LATEST_TRANSITION_MS;
  return {
    epochIndex,
    progress: holding ? 1 : segmentElapsed / LATEST_TRANSITION_MS,
    holding,
    complete: false
  };
}
