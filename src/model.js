// Default model parameters - all user-adjustable via preset buttons
// rabbitsPerUnit and reliability values are snapped to the nearest UI preset
// (мало=0.3 / средне=1.0 / много=2.0  and  слабо=0.3 / средне=0.6 / сильно=0.9)
export const DEFAULT_PARAMS = {
  rabbitsPerUnit: {
    missing_carrot:  0.3,  // мало
    new_hole:        1.0,  // средне
    motion_sensor:   2.0,  // много
    rustle_detected: 0.3,  // мало
    footprints:      0.3,  // мало
  },
  reliability: {
    missing_carrot:  0.3,  // слабо
    new_hole:        0.6,  // средне
    rustle_detected: 0.6,  // средне
    footprints:      0.6,  // средне
    motion_sensor:   0.9,  // сильно
  },
  // Cross-zone movement window in minutes (presets: медленно=60 / средне=30 / быстро=15)
  movementWindowMinutes: 30,
}

// Confidence scoring weights - must sum to 1.0
export const CONFIDENCE_WEIGHTS = {
  diversity:   0.35, // unique signal types / 5
  intensity:   0.30, // average intensity / 10
  consistency: 0.35, // how evenly signals distribute across zones
}

// Events of same type+location within this window are the same rabbits milling in place
const COLLAPSE_WINDOW_MINUTES = 60

// Fraction of the smaller cross-zone contribution to subtract when rabbits may have moved
const MOVEMENT_COEFFICIENT = 0.5

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export function eventContribution(evt, params) {
  const rpu = params.rabbitsPerUnit[evt.event] ?? 1
  const rel = params.reliability[evt.event] ?? 0.5
  return evt.count * rpu * rel * (evt.intensity / 10)
}

// ── Layer 1: same-type+same-zone collapse ──────────────────────────────────
// Events clustered within COLLAPSE_WINDOW_MINUTES: keep the max-contribution
// winner (they're the same rabbits seen multiple times in the same spot).
function collapseEvents(events, params) {
  const groups = new Map()
  for (const evt of events) {
    const key = `${evt.event}::${evt.location}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(evt)
  }

  const result = []
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => timeToMinutes(a.time) - timeToMinutes(b.time)
    )
    let clusterStart = timeToMinutes(sorted[0].time)
    let cluster = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const t = timeToMinutes(sorted[i].time)
      if (t - clusterStart <= COLLAPSE_WINDOW_MINUTES) {
        cluster.push(sorted[i])
      } else {
        result.push(pickBest(cluster, params))
        cluster = [sorted[i]]
        clusterStart = t
      }
    }
    result.push(pickBest(cluster, params))
  }
  return result
}

function pickBest(cluster, params) {
  return cluster.reduce((best, cur) =>
    eventContribution(cur, params) > eventContribution(best, params) ? cur : best
  )
}

// ── Layer 2: cross-zone movement correction ────────────────────────────────
// After layer-1 collapse, some pairs of events in DIFFERENT zones within
// movementWindowMinutes may represent the same rabbit that moved. This is
// probabilistic: subtract MOVEMENT_COEFFICIENT × min(a, b) from the smaller
// event's contribution. Never zero it out — different rabbits remain possible.
// Exclusion: timeDiff === 0 → simultaneous events in different zones are
//            definitely different rabbits (no subtraction).
function applyMovementCorrection(collapsedEvents, params) {
  const windowMinutes = params.movementWindowMinutes ?? 30
  const n = collapsedEvents.length
  if (n < 2) {
    return collapsedEvents.reduce((s, e) => s + eventContribution(e, params), 0)
  }

  const values = collapsedEvents.map(e => eventContribution(e, params))
  // Accumulated reduction per event — applied at the end with a floor of 0
  const reductions = new Array(n).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (collapsedEvents[i].location === collapsedEvents[j].location) continue

      const dt = Math.abs(
        timeToMinutes(collapsedEvents[i].time) - timeToMinutes(collapsedEvents[j].time)
      )
      // Same time → definitely different rabbits; beyond window → unrelated
      if (dt === 0 || dt > windowMinutes) continue

      const smallerIdx = values[i] <= values[j] ? i : j
      reductions[smallerIdx] += Math.min(values[i], values[j]) * MOVEMENT_COEFFICIENT
    }
  }

  return values.reduce((sum, v, i) => sum + Math.max(0, v - reductions[i]), 0)
}

// Total estimated rabbit count (layer-1 collapse + layer-2 movement correction)
export function calculateRabbits(events, params) {
  if (!events.length) return 0
  const collapsed = collapseEvents(events, params)
  return applyMovementCorrection(collapsed, params)
}

// Confidence score 0..100 from three weighted factors
export function calculateConfidence(events, params, knownTypeCount = 5) {
  if (!events.length) return 0

  // Factor 1: signal type diversity
  const uniqueTypes = new Set(events.map(e => e.event)).size
  const diversity = Math.min(uniqueTypes / knownTypeCount, 1)

  // Factor 2: average signal intensity
  const avgIntensity =
    events.reduce((s, e) => s + e.intensity, 0) / events.length / 10

  // Factor 3: consistency - 1 minus coefficient of variation across zones.
  // Use collapsed events so duplicate same-type+zone signals don't inflate one zone's weight.
  const collapsed = collapseEvents(events, params)
  const zoneTotals = {}
  for (const evt of collapsed) {
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

  const { diversity: wd, intensity: wi, consistency: wc } = CONFIDENCE_WEIGHTS
  const raw = wd * diversity + wi * avgIntensity + wc * consistency
  return Math.round(Math.min(Math.max(raw * 100, 0), 100))
}

// Per-event contribution as percent of total (collapsed losers get 0%)
// Note: percentages are computed from pre-correction contributions; they reflect
// relative signal importance, not exact fractions of the corrected total.
export function calculateContributions(events, params) {
  if (!events.length) return []
  const collapsed = collapseEvents(events, params)
  const winnerIds = new Set(collapsed.map(e => e.id))
  const scores = events.map(evt => ({
    id: evt.id,
    value: winnerIds.has(evt.id) ? eventContribution(evt, params) : 0,
  }))
  const total = scores.reduce((s, c) => s + c.value, 0)
  if (total === 0) return scores.map(c => ({ ...c, percent: 0 }))
  return scores.map(c => ({
    ...c,
    percent: Math.round((c.value / total) * 100),
  }))
}

// Rabbit estimate per farm zone (layer-1 collapse only; no cross-zone correction
// since each zone's subset has no cross-zone pairs by definition)
export function calculateByZone(events, params) {
  const zones = {}
  for (const evt of events) {
    if (!zones[evt.location]) zones[evt.location] = []
    zones[evt.location].push(evt)
  }
  return Object.fromEntries(
    Object.entries(zones).map(([loc, evts]) => [loc, calculateRabbits(evts, params)])
  )
}
