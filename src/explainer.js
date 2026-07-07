import { EVENT_META } from './data.js'

// Prepositional/locative form — used with "наследили ..."
const ZONE_LOCATIVE = {
  'Огород':   'в огороде',
  'У забора': 'у забора',
  'Сарай':    'в сарае',
  'Теплица':  'в теплице',
}

// Dative form — used with "не верим"
const SIGNAL_DATIVE = {
  missing_carrot:  'морковке',
  new_hole:        'ямкам',
  motion_sensor:   'датчику движения',
  rustle_detected: 'шуршанию',
  footprints:      'следам',
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

function countSentence(rabbits) {
  if (rabbits < 0.3) return 'Следов пока мало.'
  const lo = Math.max(1, Math.floor(rabbits))
  const hi = Math.ceil(rabbits)
  if (lo === hi) {
    const word = lo === 1 ? 'кролик' : lo <= 4 ? 'кролика' : 'кроликов'
    return `Около ${lo} ${word}.`
  }
  return `Около ${lo}–${hi} кроликов.`
}

// Instant JS subtitle for the header — built from computed data, never calls the network.
// Correct Russian case forms are pre-declared; no naive concatenation.
export function buildSubtitle(rabbits, byZone, events, params) {
  const parts = [countSentence(rabbits)]

  if (events.length === 0) return parts.join(' ')

  // Top 1–2 zones with meaningful rabbit activity
  const activeZones = Object.entries(byZone)
    .filter(([, v]) => v > 0.3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)

  if (activeZones.length === 1) {
    const loc = ZONE_LOCATIVE[activeZones[0][0]] ?? `в ${activeZones[0][0].toLowerCase()}`
    parts.push(`Больше всего наследили ${loc}.`)
  } else if (activeZones.length >= 2) {
    const loc1 = ZONE_LOCATIVE[activeZones[0][0]] ?? activeZones[0][0]
    const loc2 = ZONE_LOCATIVE[activeZones[1][0]] ?? activeZones[1][0]
    parts.push(`Больше всего наследили ${loc1} и ${loc2}.`)
  }

  // Signal types where reliability is low AND events of that type exist
  const presentTypes = new Set(events.map(e => e.event))
  const lowRel = Object.entries(params.reliability)
    .filter(([type, rel]) => rel < 0.4 && presentTypes.has(type))
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)

  if (lowRel.length === 1) {
    const name = SIGNAL_DATIVE[lowRel[0][0]]
      ?? EVENT_META[lowRel[0][0]]?.label?.toLowerCase()
      ?? lowRel[0][0]
    parts.push(`${cap(name)} почти не верим — слабый признак.`)
  } else if (lowRel.length >= 2) {
    const n0 = SIGNAL_DATIVE[lowRel[0][0]] ?? lowRel[0][0]
    const n1 = SIGNAL_DATIVE[lowRel[1][0]] ?? lowRel[1][0]
    parts.push(`${cap(n0)} и ${n1} почти не верим.`)
  }

  return parts.join(' ')
}
