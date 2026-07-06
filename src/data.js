export const INITIAL_EVENTS = [
  { id: 'evt_001', event: 'missing_carrot', location: 'Огород',   count: 5, intensity: 4, time: '08:30' },
  { id: 'evt_002', event: 'new_hole',        location: 'У забора', count: 2, intensity: 7, time: '09:10' },
  { id: 'evt_003', event: 'motion_sensor',   location: 'Сарай',    count: 1, intensity: 8, time: '10:05' },
  { id: 'evt_004', event: 'rustle_detected', location: 'Сарай',    count: 3, intensity: 5, time: '10:20' },
  { id: 'evt_005', event: 'footprints',      location: 'Теплица',  count: 6, intensity: 6, time: '11:45' },
]

export const EVENT_TYPES = [
  'missing_carrot',
  'new_hole',
  'motion_sensor',
  'rustle_detected',
  'footprints',
]

export const LOCATIONS = ['Огород', 'У забора', 'Сарай', 'Теплица']

export const EVENT_META = {
  missing_carrot:  { label: 'Пропала морковка', emoji: '🥕' },
  new_hole:        { label: 'Новая ямка',        emoji: '🕳️' },
  motion_sensor:   { label: 'Датчик движения',   emoji: '📡' },
  rustle_detected: { label: 'Шуршание',           emoji: '👂' },
  footprints:      { label: 'Следы',              emoji: '🐾' },
}
