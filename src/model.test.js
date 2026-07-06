import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PARAMS,
  eventContribution,
  calculateRabbits,
  calculateConfidence,
  calculateContributions,
  calculateByZone,
} from './model.js'

// Helpers
const evt = (overrides) => ({
  id: 'x',
  event: 'footprints',
  location: 'Огород',
  count: 1,
  intensity: 10,
  time: '10:00',
  ...overrides,
})

describe('eventContribution', () => {
  it('computes count * rpu * reliability * intensity/10', () => {
    const e = evt({ event: 'motion_sensor', count: 2, intensity: 8 })
    // 2 * 2.0 * 0.9 * 0.8 = 2.88
    expect(eventContribution(e, DEFAULT_PARAMS)).toBeCloseTo(2.88)
  })
})

describe('calculateRabbits', () => {
  it('returns 0 for empty events', () => {
    expect(calculateRabbits([], DEFAULT_PARAMS)).toBe(0)
  })

  it('sums contributions for independent events', () => {
    const events = [
      evt({ id: 'a', event: 'motion_sensor', location: 'Сарай',   count: 1, intensity: 8, time: '10:00' }),
      evt({ id: 'b', event: 'footprints',    location: 'Теплица', count: 3, intensity: 6, time: '10:00' }),
    ]
    const expected =
      eventContribution(events[0], DEFAULT_PARAMS) +
      eventContribution(events[1], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(expected)
  })

  it('collapses same type+location within 60 min — takes max, not sum', () => {
    const events = [
      evt({ id: 'lo', event: 'motion_sensor', location: 'Сарай', count: 1, intensity: 2, time: '10:00' }),
      evt({ id: 'hi', event: 'motion_sensor', location: 'Сарай', count: 2, intensity: 9, time: '10:45' }),
    ]
    const hiScore = eventContribution(events[1], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(hiScore)
  })

  it('does NOT collapse same type+location beyond 60 min', () => {
    const events = [
      evt({ id: 'a', event: 'motion_sensor', location: 'Сарай', count: 1, intensity: 8, time: '10:00' }),
      evt({ id: 'b', event: 'motion_sensor', location: 'Сарай', count: 1, intensity: 8, time: '11:05' }),
    ]
    const single = eventContribution(events[0], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(single * 2)
  })

  it('does NOT collapse different types in the same location', () => {
    const events = [
      evt({ id: 'a', event: 'motion_sensor',   location: 'Сарай', count: 1, intensity: 8, time: '10:00' }),
      evt({ id: 'b', event: 'rustle_detected', location: 'Сарай', count: 1, intensity: 8, time: '10:10' }),
    ]
    const expected =
      eventContribution(events[0], DEFAULT_PARAMS) +
      eventContribution(events[1], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(expected)
  })

  it('does NOT collapse same type in different locations', () => {
    // Use timeDiff=0 to isolate from cross-zone movement correction
    // (simultaneous sightings in different zones = definitely different rabbits)
    const events = [
      evt({ id: 'a', location: 'Огород',  time: '10:00' }),
      evt({ id: 'b', location: 'Теплица', time: '10:00' }),
    ]
    const expected =
      eventContribution(events[0], DEFAULT_PARAMS) +
      eventContribution(events[1], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(expected)
  })

  it('collapses to 0 if all are losers of one cluster', () => {
    // Same type+location, within window — only the highest wins
    const events = [
      evt({ id: 'a', count: 1, intensity: 3, time: '10:00' }),
      evt({ id: 'b', count: 1, intensity: 5, time: '10:20' }),
      evt({ id: 'c', count: 1, intensity: 2, time: '10:40' }),
    ]
    const hiScore = eventContribution(events[1], DEFAULT_PARAMS)
    expect(calculateRabbits(events, DEFAULT_PARAMS)).toBeCloseTo(hiScore)
  })

  it('respects custom params', () => {
    const events = [evt({ event: 'footprints', count: 1, intensity: 10 })]
    const customParams = {
      ...DEFAULT_PARAMS,
      rabbitsPerUnit: { ...DEFAULT_PARAMS.rabbitsPerUnit, footprints: 5.0 },
    }
    // 5.0 * DEFAULT_PARAMS.reliability.footprints * 1.0 (intensity/10 = 1)
    expect(calculateRabbits(events, customParams)).toBeCloseTo(
      5.0 * DEFAULT_PARAMS.reliability.footprints * 1.0
    )
  })
})

describe('calculateConfidence', () => {
  it('returns 0 for empty events', () => {
    expect(calculateConfidence([], DEFAULT_PARAMS)).toBe(0)
  })

  it('returns integer in range 0..100', () => {
    const events = [evt({ event: 'motion_sensor', intensity: 8 })]
    const conf = calculateConfidence(events, DEFAULT_PARAMS)
    expect(Number.isInteger(conf)).toBe(true)
    expect(conf).toBeGreaterThanOrEqual(0)
    expect(conf).toBeLessThanOrEqual(100)
  })

  it('never exceeds 100 even with perfect inputs', () => {
    const events = [
      evt({ id: 'a', event: 'motion_sensor',   location: 'Сарай',    intensity: 10 }),
      evt({ id: 'b', event: 'footprints',      location: 'Огород',   intensity: 10 }),
      evt({ id: 'c', event: 'new_hole',        location: 'У забора', intensity: 10 }),
      evt({ id: 'd', event: 'rustle_detected', location: 'Теплица',  intensity: 10 }),
      evt({ id: 'e', event: 'missing_carrot',  location: 'Огород',   intensity: 10 }),
    ]
    expect(calculateConfidence(events, DEFAULT_PARAMS)).toBeLessThanOrEqual(100)
  })

  it('higher signal diversity → higher confidence', () => {
    // Same zone to neutralise consistency; only diversity factor differs
    const oneType = [
      evt({ id: 'a', event: 'footprints', location: 'Огород', intensity: 7, time: '10:00' }),
      evt({ id: 'b', event: 'footprints', location: 'Огород', intensity: 7, time: '12:00' }),
    ]
    const twoTypes = [
      evt({ id: 'a', event: 'footprints', location: 'Огород', intensity: 7, time: '10:00' }),
      evt({ id: 'b', event: 'new_hole',   location: 'Огород', intensity: 7, time: '12:00' }),
    ]
    expect(calculateConfidence(twoTypes, DEFAULT_PARAMS)).toBeGreaterThan(
      calculateConfidence(oneType, DEFAULT_PARAMS)
    )
  })

  it('higher intensity → higher confidence', () => {
    const low  = [evt({ intensity: 1 })]
    const high = [evt({ intensity: 10 })]
    expect(calculateConfidence(high, DEFAULT_PARAMS)).toBeGreaterThan(
      calculateConfidence(low, DEFAULT_PARAMS)
    )
  })

  it('collapsed duplicates do not inflate one zone — consistency equals single-event baseline', () => {
    // Two footprints in Огород within 60 min collapse to the winner.
    // Loser has the same intensity as winner so raw avgIntensity stays equal,
    // letting us isolate the consistency factor.
    // A second zone (Теплица) provides the cross-zone comparison.
    const winner = evt({ id: 'hi', location: 'Огород',  count: 2, intensity: 8, time: '10:00' })
    const loser  = evt({ id: 'lo', location: 'Огород',  count: 1, intensity: 8, time: '10:30' })
    const other  = evt({ id: 'ot', location: 'Теплица', count: 1, intensity: 8, time: '10:00' })

    const withDuplicate   = calculateConfidence([winner, loser, other], DEFAULT_PARAMS)
    const withoutDuplicate = calculateConfidence([winner, other],        DEFAULT_PARAMS)
    expect(withDuplicate).toBe(withoutDuplicate)
  })
})

describe('calculateContributions', () => {
  it('returns empty array for empty events', () => {
    expect(calculateContributions([], DEFAULT_PARAMS)).toEqual([])
  })

  it('percentages of all non-zero contributions sum to ~100', () => {
    const events = [
      evt({ id: 'a', event: 'motion_sensor', location: 'Сарай',    count: 1, intensity: 8 }),
      evt({ id: 'b', event: 'footprints',    location: 'Теплица',  count: 3, intensity: 6 }),
      evt({ id: 'c', event: 'new_hole',      location: 'У забора', count: 2, intensity: 7 }),
    ]
    const contribs = calculateContributions(events, DEFAULT_PARAMS)
    const total = contribs.reduce((s, c) => s + c.percent, 0)
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2) // rounding tolerance
  })

  it('collapsed loser gets 0% contribution', () => {
    const events = [
      evt({ id: 'winner', count: 3, intensity: 9, time: '10:00' }),
      evt({ id: 'loser',  count: 1, intensity: 1, time: '10:30' }),
    ]
    const contribs = calculateContributions(events, DEFAULT_PARAMS)
    expect(contribs.find(c => c.id === 'loser').percent).toBe(0)
    expect(contribs.find(c => c.id === 'winner').percent).toBe(100)
  })

  it('each contribution has id, value, percent fields', () => {
    const events = [evt({ id: 'e1' })]
    const contribs = calculateContributions(events, DEFAULT_PARAMS)
    expect(contribs[0]).toMatchObject({ id: 'e1', value: expect.any(Number), percent: expect.any(Number) })
  })
})

describe('cross-zone movement correction', () => {
  // Use a fixed 30-min window explicitly so tests are independent of DEFAULT_PARAMS changes
  const P = { ...DEFAULT_PARAMS, movementWindowMinutes: 30 }

  it('same time, different zones → no correction (definitely different rabbits)', () => {
    const events = [
      evt({ id: 'a', location: 'Огород',  time: '10:00' }),
      evt({ id: 'b', location: 'Теплица', time: '10:00' }),
    ]
    const expected = eventContribution(events[0], P) + eventContribution(events[1], P)
    expect(calculateRabbits(events, P)).toBeCloseTo(expected)
  })

  it('close time, different zones → partial reduction, never zero', () => {
    const events = [
      evt({ id: 'a', location: 'Огород',  time: '10:00' }),
      evt({ id: 'b', location: 'Теплица', time: '10:20' }),
    ]
    const raw = eventContribution(events[0], P) + eventContribution(events[1], P)
    const result = calculateRabbits(events, P)
    expect(result).toBeLessThan(raw)
    expect(result).toBeGreaterThan(0)
    // Both events identical → smaller === either → reduction = value * 0.5
    const val = eventContribution(events[0], P)
    expect(result).toBeCloseTo(raw - val * 0.5)
  })

  it('time beyond window → no correction', () => {
    const events = [
      evt({ id: 'a', location: 'Огород',  time: '10:00' }),
      evt({ id: 'b', location: 'Теплица', time: '10:35' }), // 35 min > 30-min window
    ]
    const expected = eventContribution(events[0], P) + eventContribution(events[1], P)
    expect(calculateRabbits(events, P)).toBeCloseTo(expected)
  })

  it('reduction targets the smaller-contribution event only', () => {
    const strong = evt({ id: 's', location: 'Сарай',   event: 'motion_sensor', count: 3, intensity: 9, time: '10:00' })
    const weak   = evt({ id: 'w', location: 'Теплица', event: 'footprints',    count: 1, intensity: 2, time: '10:15' })
    const weakVal   = eventContribution(weak,   P)
    const strongVal = eventContribution(strong, P)
    const result = calculateRabbits([strong, weak], P)
    // Weak is smaller → reduction = weakVal * 0.5 subtracted from weak only
    expect(result).toBeCloseTo(strongVal + weakVal * 0.5)
  })

  it('same zone, close time → no movement correction (layer-1 collapse applies instead)', () => {
    const events = [
      evt({ id: 'a', location: 'Огород', count: 1, intensity: 8, time: '10:00' }),
      evt({ id: 'b', location: 'Огород', count: 1, intensity: 8, time: '10:20' }),
    ]
    // Same type+zone within 60 min → collapses to one; movement correction skips same-zone pairs
    const singleScore = eventContribution(events[0], P)
    expect(calculateRabbits(events, P)).toBeCloseTo(singleScore)
  })

  it('movementWindowMinutes=0 disables cross-zone correction entirely', () => {
    const noMovement = { ...P, movementWindowMinutes: 0 }
    const events = [
      evt({ id: 'a', location: 'Огород',  time: '10:00' }),
      evt({ id: 'b', location: 'Теплица', time: '10:01' }),
    ]
    const expected = eventContribution(events[0], noMovement) + eventContribution(events[1], noMovement)
    expect(calculateRabbits(events, noMovement)).toBeCloseTo(expected)
  })
})

describe('calculateByZone', () => {
  it('returns empty object for empty events', () => {
    expect(calculateByZone([], DEFAULT_PARAMS)).toEqual({})
  })

  it('splits estimates by location', () => {
    const events = [
      evt({ id: 'a', location: 'Огород',  count: 1, intensity: 10 }),
      evt({ id: 'b', location: 'Теплица', count: 2, intensity: 10 }),
    ]
    const byZone = calculateByZone(events, DEFAULT_PARAMS)
    expect(byZone['Огород']).toBeCloseTo(
      eventContribution(events[0], DEFAULT_PARAMS)
    )
    expect(byZone['Теплица']).toBeCloseTo(
      eventContribution(events[1], DEFAULT_PARAMS)
    )
  })

  it('applies intra-zone collapsing', () => {
    const events = [
      evt({ id: 'lo', location: 'Огород', count: 1, intensity: 2, time: '10:00' }),
      evt({ id: 'hi', location: 'Огород', count: 1, intensity: 9, time: '10:30' }),
    ]
    const byZone = calculateByZone(events, DEFAULT_PARAMS)
    const hiScore = eventContribution(events[1], DEFAULT_PARAMS)
    expect(byZone['Огород']).toBeCloseTo(hiScore)
  })
})
