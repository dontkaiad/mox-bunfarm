// Prepositional/locative form — used with "наследили ..."
const ZONE_LOCATIVE = {
  'Огород':   'в огороде',
  'У забора': 'у забора',
  'Сарай':    'в сарае',
  'Теплица':  'в теплице',
}

// Dative form — used with "не верим". Only defined for built-in types;
// custom types fall through to the label-based template below.
const SIGNAL_DATIVE = {
  missing_carrot:  'морковке',
  new_hole:        'ямкам',
  motion_sensor:   'датчику движения',
  rustle_detected: 'шуршанию',
  footprints:      'следам',
}

// Nominative form — used in "Почти не влияет/влияют: …" when mixing
// built-in and custom types in one sentence.
const SIGNAL_NOMINATIVE = {
  missing_carrot:  'морковка',
  new_hole:        'ямки',
  motion_sensor:   'датчик движения',
  rustle_detected: 'шуршание',
  footprints:      'следы',
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
// eventMeta must include custom types (pass allEventMeta from App, not raw EVENT_META).
export function buildSubtitle(rabbits, byZone, events, params, eventMeta = {}) {
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
    const id = lowRel[0][0]
    const dative = SIGNAL_DATIVE[id]
    if (dative) {
      parts.push(`${cap(dative)} почти не верим — слабый признак.`)
    } else {
      const label = eventMeta[id]?.label ?? id
      parts.push(`Почти не влияет: ${label.toLowerCase()}.`)
    }
  } else if (lowRel.length >= 2) {
    const d0 = SIGNAL_DATIVE[lowRel[0][0]]
    const d1 = SIGNAL_DATIVE[lowRel[1][0]]
    if (d0 && d1) {
      parts.push(`${cap(d0)} и ${d1} почти не верим.`)
    } else {
      const n0 = SIGNAL_NOMINATIVE[lowRel[0][0]] ?? eventMeta[lowRel[0][0]]?.label ?? lowRel[0][0]
      const n1 = SIGNAL_NOMINATIVE[lowRel[1][0]] ?? eventMeta[lowRel[1][0]]?.label ?? lowRel[1][0]
      parts.push(`Почти не влияют: ${n0.toLowerCase()} и ${n1.toLowerCase()}.`)
    }
  }

  return parts.join(' ')
}
