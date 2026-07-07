import { CONFIDENCE_WEIGHTS } from './model.js'

// Computes the three confidence sub-factors for UI display.
// Uses raw events (not collapsed) — matches model.js closely enough for display;
// small deviations only appear when same-type+zone duplicates are present.
const timeToMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

export function getConfidenceFactors(events, params) {
  if (!events.length) {
    return { diversity: 0, avgIntensity: 0, consistency: 0 }
  }

  const uniqueTypes = new Set(events.map(e => e.event)).size
  const diversity = Math.min(uniqueTypes / 5, 1)

  const avgIntensity =
    events.reduce((s, e) => s + e.intensity, 0) / events.length / 10

  // Time-aware cross-zone consistency (mirrors model.js calculateConfidence logic).
  // dt=0 different zones   → clear (definitely different rabbits, picture sharp).
  // 0 < dt ≤ window        → ambiguous (possibly one rabbit moving between zones).
  // dt > window / same zone → excluded (neutral, no cross-zone information).
  // Scale: 0.5 neutral → 1.0 all-simultaneous → 0.0 all-ambiguous.
  const mvWindow = params.movementWindowMinutes ?? 30
  let clearPairs = 0, ambiguousPairs = 0
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (events[i].location === events[j].location) continue
      const dt = Math.abs(timeToMin(events[i].time) - timeToMin(events[j].time))
      if (dt === 0)            clearPairs++
      else if (dt <= mvWindow) ambiguousPairs++
    }
  }
  const totalCross = clearPairs + ambiguousPairs
  const consistency = totalCross === 0 ? 0.5 : clearPairs / totalCross

  return { diversity, avgIntensity, consistency }
}

// Returns the display weights matching CONFIDENCE_WEIGHTS (as integer %)
export const FACTOR_WEIGHTS = {
  diversity:   Math.round(CONFIDENCE_WEIGHTS.diversity   * 100),
  intensity:   Math.round(CONFIDENCE_WEIGHTS.intensity   * 100),
  consistency: Math.round(CONFIDENCE_WEIGHTS.consistency * 100),
}
