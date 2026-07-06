// Default model parameters - all user-adjustable via sliders
export const DEFAULT_PARAMS = {
  rabbitsPerUnit: {
    missing_carrot:  0.3, // 1 carrot ≈ 0.3 rabbits (weak signal)
    new_hole:        1.0, // 1 hole ≈ 1 rabbit
    motion_sensor:   2.0, // 1 trigger ≈ 2 rabbits (strong signal)
    rustle_detected: 0.5,
    footprints:      0.4,
  },
  reliability: {
    missing_carrot:  0.4,
    new_hole:        0.6,
    rustle_detected: 0.5,
    footprints:      0.7,
    motion_sensor:   0.9,
  },
}

// Confidence scoring weights - must sum to 1.0
export const CONFIDENCE_WEIGHTS = {
  diversity:   0.35, // unique signal types / 5
  intensity:   0.30, // average intensity / 10
  consistency: 0.35, // how evenly signals distribute across zones
}

// Events of same type+location within this window are considered the same rabbits
const COLLAPSE_WINDOW_MINUTES = 60

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export function eventContribution(evt, params) {
  const rpu = params.rabbitsPerUnit[evt.event] ?? 1
  const rel = params.reliability[evt.event] ?? 0.5
  return evt.count * rpu * rel * (evt.intensity / 10)
}

// Collapse same-type+same-location events within COLLAPSE_WINDOW_MINUTES:
// clusters are anchored at the first event's time; keep the max-contribution winner
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

// Total estimated rabbit count (applies collapsing)
export function calculateRabbits(events, params) {
  if (!events.length) return 0
  return collapseEvents(events, params)
    .reduce((sum, evt) => sum + eventContribution(evt, params), 0)
}

// Confidence score 0..100 from three weighted factors
export function calculateConfidence(events, params) {
  if (!events.length) return 0

  // Factor 1: signal type diversity
  const uniqueTypes = new Set(events.map(e => e.event)).size
  const diversity = Math.min(uniqueTypes / 5, 1)

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

// Rabbit estimate broken down per farm zone
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
