import { useState, useMemo, useRef, useEffect } from 'react'
import { INITIAL_EVENTS, EVENT_META, EVENT_TYPES } from './data.js'
import {
  DEFAULT_PARAMS,
  calculateRabbits,
  calculateConfidence,
  calculateContributions,
  calculateByZone,
} from './model.js'
import { buildSubtitle } from './explainer.js'
import Header          from './components/Header.jsx'
import EventsTable     from './components/EventsTable.jsx'
import ModelParams     from './components/ModelParams.jsx'
import FarmMap         from './components/FarmMap.jsx'
import ZonePopup       from './components/ZonePopup.jsx'
import Recommendations from './components/Recommendations.jsx'
import Worklog            from './components/Worklog.jsx'
import EstimateBreakdown  from './components/EstimateBreakdown.jsx'
import ImportExport       from './components/ImportExport.jsx'
import './App.css'

const TABS = [
  { id: 'map',       label: '🗺️ Карта' },
  { id: 'recs',      label: '📋 Рекомендации' },
  { id: 'breakdown', label: '🔍 Разбор оценки' },
  { id: 'settings',  label: '⚙️ Настройка модели' },
  { id: 'worklog',   label: '🤖 AI Журнал' },
]

const HINT_THRESHOLD   = 0.05
const ADVISE_DEBOUNCE  = 800

export default function App() {
  const [events,      setEvents]      = useState(INITIAL_EVENTS)
  const [params,      setParams]      = useState(DEFAULT_PARAMS)
  const [customTypes, setCustomTypes] = useState([])
  const [activeZone,  setActiveZone]  = useState(null)
  const [activeTab,   setActiveTab]   = useState('map')
  const [paramHint,   setParamHint]   = useState(null)
  const [llmData,     setLlmData]     = useState(null)

  const hintTimerRef   = useRef(null)
  const adviseTimerRef = useRef(null)

  // Merge built-in types with user-created custom types
  const allEventMeta = useMemo(() => {
    const custom = Object.fromEntries(
      customTypes.map(ct => [ct.type, { label: ct.label, emoji: ct.emoji }])
    )
    return { ...EVENT_META, ...custom }
  }, [customTypes])

  const allEventTypes = useMemo(
    () => [...EVENT_TYPES, ...customTypes.map(ct => ct.type)],
    [customTypes]
  )

  const rabbits       = useMemo(() => calculateRabbits(events, params),                              [events, params])
  const confidence    = useMemo(() => calculateConfidence(events, params, allEventTypes.length),     [events, params, allEventTypes])
  const contributions = useMemo(() => calculateContributions(events, params),                        [events, params])
  const byZone        = useMemo(() => calculateByZone(events, params),                              [events, params])

  const explanation = useMemo(
    () => buildSubtitle(rabbits, byZone, events, params, allEventMeta),
    [rabbits, byZone, events, params, allEventMeta]
  )

  // ── /api/advise — fires only when observations change, not per slider tick ──
  useEffect(() => {
    clearTimeout(adviseTimerRef.current)
    adviseTimerRef.current = setTimeout(() => {
      const body = JSON.stringify({ rabbits, confidence, events, contributions, byZone, params })
      fetch('/api/advise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(12000),
      })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => setLlmData(data))
        .catch(() => setLlmData(null))
    }, ADVISE_DEBOUNCE)

    return () => clearTimeout(adviseTimerRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events])

  // ── Event CRUD ────────────────────────────────────────────────────────────
  function updateEvent(id, field, value) {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
  }
  function deleteEvent(id) {
    setEvents(prev => {
      const next = prev.filter(e => e.id !== id)
      if (activeZone && !next.some(e => e.location === activeZone)) setActiveZone(null)
      return next
    })
  }
  function addEvent(evt) {
    setEvents(prev => [...prev, evt])
  }

  // ── Event import ─────────────────────────────────────────────────────────
  function importEvents(newEvents) {
    const suffix = `_${Date.now()}`
    setEvents(prev => {
      const existingIds = new Set(prev.map(e => e.id))
      const deduped = newEvents.map(e =>
        existingIds.has(e.id) ? { ...e, id: e.id + suffix } : e
      )
      return [...prev, ...deduped]
    })
  }

  // ── Custom type registration ──────────────────────────────────────────────
  function addCustomType({ type, label, emoji, reliability, rpu }) {
    setCustomTypes(prev => [...prev, { type, label, emoji }])
    setParams(prev => ({
      ...prev,
      rabbitsPerUnit: { ...prev.rabbitsPerUnit, [type]: rpu },
      reliability:    { ...prev.reliability,    [type]: reliability },
    }))
  }

  // ── Param update with live hint ───────────────────────────────────────────
  function updateParam(category, type, value) {
    const newParams = type !== null
      ? { ...params, [category]: { ...params[category], [type]: value } }
      : { ...params, [category]: value }

    const newRabbits = calculateRabbits(events, newParams)
    const diff = newRabbits - rabbits

    if (Math.abs(diff) >= HINT_THRESHOLD) {
      const direction = diff > 0 ? 'выросла' : 'снизилась'
      let subject
      if (type === null) {
        subject = 'поправка на перемещение изменилась'
      } else if (category === 'reliability') {
        const verb = diff > 0 ? 'сильнее' : 'слабее'
        const label = allEventMeta[type]?.label?.toLowerCase() ?? type
        subject = `${label} — теперь верим ${verb}`
      } else {
        const label = allEventMeta[type]?.label?.toLowerCase() ?? type
        subject = `вес за ${label} изменён`
      }
      const target = type !== null ? `${category}.${type}` : category
      setParamHint({ text: `${subject}, оценка ${direction}`, target })
      clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setParamHint(null), 2500)
    }

    if (type !== null) {
      setParams(prev => ({ ...prev, [category]: { ...prev[category], [type]: value } }))
    } else {
      setParams(prev => ({ ...prev, [category]: value }))
    }
  }

  function handleZoneClick(zone) {
    setActiveZone(prev => (prev === zone ? null : zone))
  }

  const zoneEvents = activeZone ? events.filter(e => e.location === activeZone) : []
  const llmRecs    = llmData?.source === 'llm' ? llmData.recommendations : null

  return (
    <div className="app">
      <Header rabbits={rabbits} confidence={confidence} explanation={explanation} />

      <div className="main-layout">
        <div className="left-panel">
          <div className="panel" style={{ padding: '10px 12px 12px' }}>
            <EventsTable
              events={events}
              contributions={contributions}
              onUpdate={updateEvent}
              onDelete={deleteEvent}
              onAdd={addEvent}
              allEventMeta={allEventMeta}
              allEventTypes={allEventTypes}
              onAddCustomType={addCustomType}
            />
            <ImportExport
              events={events}
              rabbits={rabbits}
              confidence={confidence}
              contributions={contributions}
              byZone={byZone}
              onImport={importEvents}
              params={params}
              eventMeta={allEventMeta}
              llmRecs={llmRecs}
              explanation={explanation}
            />
          </div>
        </div>

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
                    eventMeta={allEventMeta}
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
                llmRecs={llmRecs}
              />
            )}

            {activeTab === 'breakdown' && (
              <EstimateBreakdown
                rabbits={rabbits}
                confidence={confidence}
                contributions={contributions}
                events={events}
                params={params}
                eventMeta={allEventMeta}
              />
            )}

            {activeTab === 'settings' && (
              <ModelParams
                params={params}
                onUpdate={updateParam}
                hint={paramHint}
                eventMeta={allEventMeta}
                eventTypes={allEventTypes}
              />
            )}

            {activeTab === 'worklog' && <Worklog />}
          </div>
        </div>
      </div>
    </div>
  )
}
