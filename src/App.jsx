import { useState, useMemo } from 'react'
import { INITIAL_EVENTS } from './data.js'
import {
  DEFAULT_PARAMS,
  calculateRabbits,
  calculateConfidence,
  calculateContributions,
  calculateByZone,
} from './model.js'
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

export default function App() {
  const [events,     setEvents]     = useState(INITIAL_EVENTS)
  const [params,     setParams]     = useState(DEFAULT_PARAMS)
  const [activeZone, setActiveZone] = useState(null)
  const [activeTab,  setActiveTab]  = useState('map')

  // All calculations rerun instantly on any events/params change
  const rabbits      = useMemo(() => calculateRabbits(events, params),       [events, params])
  const confidence   = useMemo(() => calculateConfidence(events, params),    [events, params])
  const contributions = useMemo(() => calculateContributions(events, params), [events, params])
  const byZone       = useMemo(() => calculateByZone(events, params),        [events, params])

  // Event CRUD
  function updateEvent(id, field, value) {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
  }
  function deleteEvent(id) {
    setEvents(prev => prev.filter(e => e.id !== id))
    if (activeZone) {
      // If deleted event was the only one in that zone, close popup
      const remaining = events.filter(e => e.id !== id && e.location === activeZone)
      if (remaining.length === 0) setActiveZone(null)
    }
  }
  function addEvent(evt) {
    setEvents(prev => [...prev, evt])
  }

  // Model param update: (category, eventType, newValue)
  function updateParam(category, type, value) {
    setParams(prev => ({
      ...prev,
      [category]: { ...prev[category], [type]: value },
    }))
  }

  function handleZoneClick(zone) {
    setActiveZone(prev => (prev === zone ? null : zone))
  }

  const zoneEvents = activeZone ? events.filter(e => e.location === activeZone) : []

  return (
    <div className="app">
      <Header rabbits={rabbits} confidence={confidence} />

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

          <ModelParams params={params} onUpdate={updateParam} />
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
