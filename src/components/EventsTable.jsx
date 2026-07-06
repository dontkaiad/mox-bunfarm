import { useState } from 'react'
import { EVENT_META, EVENT_TYPES, LOCATIONS } from '../data.js'

const BLANK = { event: 'footprints', location: 'Огород', count: 1, intensity: 5, time: '12:00' }

export default function EventsTable({ events, contributions, onUpdate, onDelete, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(BLANK)

  const pctMap = Object.fromEntries(contributions.map(c => [c.id, c.percent]))

  function handleAdd() {
    const id = `evt_${Date.now()}`
    onAdd({ ...draft, id })
    setAdding(false)
    setDraft(BLANK)
  }

  function setDraftField(field, value) {
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div>
      <div className="section-title">📋 Сигналы ({events.length})</div>

      <div className="events-scroll">
        <table className="events-table">
          <colgroup>
            <col className="c-signal" />
            <col className="c-location" />
            <col className="c-count" />
            <col className="c-intensity" />
            <col className="c-pct" />
            <col className="c-del" />
          </colgroup>
          <thead>
            <tr>
              <th>Сигнал</th>
              <th>Место</th>
              <th title="Количество">Кол.</th>
              <th title="Интенсивность 1-10">Инт.</th>
              <th title="Вклад в общую оценку">%</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map(evt => {
              const pct = pctMap[evt.id] ?? 0
              const meta = EVENT_META[evt.event]
              return (
                <tr key={evt.id}>
                  <td>
                    <span className="event-type-cell">
                      <span className="evt-emoji">{meta?.emoji}</span>
                      <span>{meta?.label}</span>
                    </span>
                  </td>
                  <td>{evt.location}</td>
                  <td>
                    <input
                      className="inline-num"
                      type="number" min={1} max={20}
                      value={evt.count}
                      onChange={e => onUpdate(evt.id, 'count', Math.max(1, +e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-num"
                      type="number" min={1} max={10}
                      value={evt.intensity}
                      onChange={e => onUpdate(evt.id, 'intensity', Math.min(10, Math.max(1, +e.target.value)))}
                    />
                  </td>
                  <td>
                    <span className={`pct-badge${pct >= 25 ? ' hot' : ''}`}>
                      {pct > 0 ? `${pct}%` : <span className="collapsed-badge" title="Схлопнуто">—</span>}
                    </span>
                  </td>
                  <td>
                    <button className="btn-danger" onClick={() => onDelete(evt.id)} title="Удалить">✕</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {adding ? (
        <div className="add-row">
          <select
            className="sel-type"
            value={draft.event}
            onChange={e => setDraftField('event', e.target.value)}
          >
            {EVENT_TYPES.map(t => (
              <option key={t} value={t}>{EVENT_META[t].emoji} {EVENT_META[t].label}</option>
            ))}
          </select>

          <select
            className="sel-loc"
            value={draft.location}
            onChange={e => setDraftField('location', e.target.value)}
          >
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <input
            className="inp-num"
            type="number" min={1} max={20}
            value={draft.count} placeholder="кол."
            onChange={e => setDraftField('count', +e.target.value)}
          />
          <input
            className="inp-num"
            type="number" min={1} max={10}
            value={draft.intensity} placeholder="инт."
            onChange={e => setDraftField('intensity', +e.target.value)}
          />
          <input
            className="inp-time"
            type="time"
            value={draft.time}
            onChange={e => setDraftField('time', e.target.value)}
          />

          <button className="btn-primary" onClick={handleAdd}>✓ Добавить</button>
          <button className="btn-ghost"   onClick={() => { setAdding(false); setDraft(BLANK) }}>✕</button>
        </div>
      ) : (
        <button
          className="btn-primary"
          style={{ marginTop: 8 }}
          onClick={() => setAdding(true)}
        >
          + Добавить сигнал
        </button>
      )}
    </div>
  )
}
