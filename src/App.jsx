import { useState, useMemo, useRef } from 'react'
import { INITIAL_EVENTS, EVENT_META } from './data.js'
import {
  DEFAULT_PARAMS,
  calculateRabbits,
  calculateConfidence,
  calculateContributions,
  calculateByZone,
} from './model.js'
import { buildFallbackExplanation } from './explainer.js'
import Header          from './components/Header.jsx'
import EventsTable     from './components/EventsTable.jsx'
import ModelParams     from './components/ModelParams.jsx'
import FarmMap         from './components/FarmMap.jsx'
import ZonePopup       from './components/ZonePopup.jsx'
import Recommendations from './components/Recommendations.jsx'
import Worklog         from './components/Worklog.jsx'
import './App.css'

const TABS = [
  { id: 'map',     label: '🗺️ Карта' },
  { id: 'recs',    label: '📋 Рекомендации' },
  { id: 'worklog', label: '🤖 AI Журнал' },
]

// Minimum estimate change that triggers a hint (avoids noise for tiny shifts)
const HINT_THRESHOLD = 0.05

export default function App() {
  const [events,     setEvents]     = useState(INITIAL_EVENTS)
  const [params,     setParams]     = useState(DEFAULT_PARAMS)
  const [activeZone, setActiveZone] = useState(null)
  const [activeTab,  setActiveTab]  = useState('map')

  // paramHint: { text: string, target: string } | null
  const [paramHint,  setParamHint]  = useState(null)
  const hintTimerRef = useRef(null)

  // All calculations rerun instantly on every events/params change
  const rabbits       = useMemo(() => calculateRabbits(events, params),        [events, params])
  const confidence    = useMemo(() => calculateConfidence(events, params),     [events, params])
  const contributions = useMemo(() => calculateContributions(events, params),  [events, params])
  const byZone        = useMemo(() => calculateByZone(events, params),         [events, params])

  // explanation: Phase 3 will replace buildFallbackExplanation with the LLM value from /api/advise
  const explanation = useMemo(
    () => buildFallbackExplanation(rabbits, contributions, events, params),
    [rabbits, contributions, events, params]
  )

  // ── Event CRUD ────────────────────────────────────────────────────────────
  function updateEvent(id, field, value) {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
  }
  function deleteEvent(id) {
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id)
      // Close zone popup if that zone is now empty
      if (activeZone && !next.some(e => e.location === activeZone)) setActiveZone(null)
      return next
    })
  }
  function addEvent(evt) {
    setEvents(prev => [...prev, evt])
  }

  // ── Param update with live hint ───────────────────────────────────────────
  function updateParam(category, type, value) {
    // Build the new params object to preview the estimate change before committing
    const newParams = type !== null
      ? { ...params, [category]: { ...params[category], [type]: value } }
      : { ...params, [category]: value }

    const newRabbits = calculateRabbits(events, newParams)
    const diff = newRabbits - rabbits

    if (Math.abs(diff) >= HINT_THRESHOLD) {
      const direction = diff > 0 ? 'выросла' : 'снизилась'
      let subject
      if (type === null) {
        // movementWindowMinutes
        subject = 'поправка на перемещение изменилась'
      } else if (category === 'reliability') {
        const verb = diff > 0 ? 'сильнее' : 'слабее'
        const label = EVENT_META[type]?.label?.toLowerCase() ?? type
        subject = `${label} — теперь верим ${verb}`
      } else {
        // rabbitsPerUnit
        const label = EVENT_META[type]?.label?.toLowerCase() ?? type
        subject = `вес за ${label} изменён`
      }
      const text = `${subject}, оценка ${direction}`
      const target = type !== null ? `${category}.${type}` : category

      setParamHint({ text, target })
      clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setParamHint(null), 2500)
    }

    // Apply state update
    if (type !== null) {
      setParams(prev => ({
        ...prev,
        [category]: { ...prev[category], [type]: value },
      }))
    } else {
      setParams(prev => ({ ...prev, [category]: value }))
    }
  }

  function handleZoneClick(zone) {
    setActiveZone(prev => (prev === zone ? null : zone))
  }

  const zoneEvents = activeZone ? events.filter(e => e.location === activeZone) : []

  return (
    <div className="app">
      <Header rabbits={rabbits} confidence={confidence} explanation={explanation} />

      <div className="main-layout">
        {/* ── Left control panel ── */}
        <div className="left-panel">
          <div className="panel" style={{ padding: '10px 12px 12px' }}>
            <EventsTable
              events={events}
              contributions={contributions}
              onUpdate={updateEvent}
              onDelete={deleteEvent}
              onAdd={addEvent}
            />
          </div>

          <ModelParams params={params} onUpdate={updateParam} hint={paramHint} />
        </div>

        {/* ── Right area: tabs ── */}
        <div className="right-area">
          <div className="tab-bar">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {activeTab === 'map' && (
              <div className="map-container">
                <FarmMap
                  byZone={byZone}
                  events={events}
                  activeZone={activeZone}
                  onZoneClick={handleZoneClick}
                />
                {activeZone && (
                  <ZonePopup
                    zone={activeZone}
                    events={zoneEvents}
                    estimate={byZone[activeZone] ?? 0}
                    contributions={contributions}
                    onClose={() => setActiveZone(null)}
                  />
                )}
              </div>
            )}

            {activeTab === 'recs' && (
              <Recommendations
                rabbits={rabbits}
                confidence={confidence}
                events={events}
                byZone={byZone}
                contributions={contributions}
              />
            )}

            {activeTab === 'worklog' && <Worklog />}
          </div>
        </div>
      </div>
    </div>
  )
}
