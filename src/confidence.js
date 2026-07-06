import { eventContribution, CONFIDENCE_WEIGHTS } from './model.js'

// Computes the three confidence sub-factors for UI display.
//
// Zone consistency here uses raw events (model.js uses collapsed events
// internally). Values track closely; the small deviation only shows when
// duplicate same-type+same-zone signals are present.
export function getConfidenceFactors(events, params) {
  if (!events.length) {
    return { diversity: 0, avgIntensity: 0, consistency: 0 }
  }

  const uniqueTypes = new Set(events.map(e => e.event)).size
  const diversity = Math.min(uniqueTypes / 5, 1)

  const avgIntensity =
    events.reduce((s, e) => s + e.intensity, 0) / events.length / 10

  const zoneTotals = {}
  for (const evt of events) {
    zoneTotals[evt.location] =
      (zoneTotals[evt.location] ?? 0) + eventContribution(evt, params)
  }
  const vals = Object.values(zoneTotals)
  let consistency = 1
  if (vals.length > 1) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    if (mean > 0) {
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
      const cv = Math.sqrt(variance) / mean
      consistency = Math.max(0, 1 - Math.min(cv, 1))
    }
  }

  return { diversity, avgIntensity, consistency }
}

// Returns the display weights matching CONFIDENCE_WEIGHTS (as integer %)
export const FACTOR_WEIGHTS = {
  diversity:   Math.round(CONFIDENCE_WEIGHTS.diversity   * 100),
  intensity:   Math.round(CONFIDENCE_WEIGHTS.intensity   * 100),
  consistency: Math.round(CONFIDENCE_WEIGHTS.consistency * 100),
}
