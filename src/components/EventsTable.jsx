import React, { useState } from 'react'
import { EVENT_META, EVENT_TYPES, LOCATIONS } from '../data.js'
import Tip from './Tip.jsx'

const BLANK = { event: 'footprints', location: 'Огород', count: 1, intensity: 5, time: '12:00' }

function EventForm({ initial, onSave, onCancel, onDelete, isNew }) {
  const [draft, setDraft] = useState({ ...initial })
  const set = (f, v) => setDraft(p => ({ ...p, [f]: v }))

  return (
    <div className="evt-form">
      <div className="evt-form-grid">
        <label className="evt-form-field">
          <span>Тип сигнала</span>
          <select value={draft.event} onChange={e => set('event', e.target.value)}>
            {EVENT_TYPES.map(t => (
              <option key={t} value={t}>{EVENT_META[t].emoji} {EVENT_META[t].label}</option>
            ))}
          </select>
        </label>
        <label className="evt-form-field">
          <span>Место</span>
          <select value={draft.location} onChange={e => set('location', e.target.value)}>
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="evt-form-field">
          <span>Время</span>
          <input type="time" value={draft.time} onChange={e => set('time', e.target.value)} />
        </label>
        <label className="evt-form-field">
          <span>Сколько раз</span>
          <input
            type="number" min={1} max={20}
            value={draft.count}
            onChange={e => set('count', Math.max(1, +e.target.value || 1))}
          />
        </label>
        <label className="evt-form-field">
          <span>
            Заметность (1–10){' '}
            <Tip text="Насколько чёткий след ты видишь. Явную улику система учитывает сильнее смутного намёка." />
          </span>
          <input
            type="number" min={1} max={10}
            value={draft.intensity}
            onChange={e => set('intensity', Math.min(10, Math.max(1, +e.target.value || 1)))}
          />
        </label>
      </div>
      <div className="evt-form-actions">
        <button className="btn-primary" onClick={() => onSave(draft)}>
          {isNew ? '✓ Добавить' : '✓ Сохранить'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Отмена</button>
        {!isNew && onDelete && (
          <button className="btn-danger" onClick={onDelete} style={{ marginLeft: 'auto' }}>
            Удалить
          </button>
        )}
      </div>
    </div>
  )
}

export default function EventsTable({ events, contributions, onUpdate, onDelete, onAdd }) {
  const [editingId, setEditingId] = useState(null) // null | evt.id | 'new'
  const pctMap = Object.fromEntries(contributions.map(c => [c.id, c.percent]))

  function handleSaveEdit(id, draft) {
    const original = events.find(e => e.id === id)
    if (!original) return
    for (const field of ['event', 'location', 'time', 'count', 'intensity']) {
      if (draft[field] !== original[field]) onUpdate(id, field, draft[field])
    }
    setEditingId(null)
  }

  function handleSaveNew(draft) {
    onAdd({ ...draft, id: `evt_${Date.now()}` })
    setEditingId(null)
  }

  function handleDelete(id) {
    onDelete(id)
    setEditingId(null)
  }

  return (
    <div>
      <div className="section-title">📋 Сигналы ({events.length})</div>
      <div className="events-intro">
        Здесь ты записываешь, что заметил на ферме. Система по этим следам оценивает кроликов.
      </div>

      <div className="events-scroll">
        <table className="events-table">
          <colgroup>
            <col className="c-signal" />
            <col className="c-location" />
            <col className="c-time" />
            <col className="c-count" />
            <col className="c-intensity" />
            <col className="c-pct" />
          </colgroup>
          <thead>
            <tr>
              <th>Сигнал</th>
              <th>Место</th>
              <th>
                Время
                <Tip text="Когда заметил след. Следы рядом по времени в одном месте считаются одним кроликом; в разных зонах — зависит от скорости перемещения." />
              </th>
              <th title="Сколько раз замечено">Сколько</th>
              <th>
                Заметность
                <Tip text="Заметность следа: 1 — едва видно, 10 — очень ярко. Явную улику система учитывает сильнее." />
              </th>
              <th>
                вклад
                <Tip text="Какую долю итоговой оценки даёт этот сигнал. Схлопнутые дубли показывают —." />
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map(evt => {
              const pct    = pctMap[evt.id] ?? 0
              const meta   = EVENT_META[evt.event]
              const isOpen = editingId === evt.id
              return (
                <React.Fragment key={evt.id}>
                  <tr
                    className={`evt-row${isOpen ? ' evt-row-open' : ''}`}
                    onClick={() => setEditingId(isOpen ? null : evt.id)}
                    title="Нажми, чтобы изменить"
                  >
                    <td>
                      <span className="event-type-cell">
                        <span className="evt-emoji">{meta?.emoji}</span>
                        <span>{meta?.label}</span>
                      </span>
                    </td>
                    <td>{evt.location}</td>
                    <td className="evt-time">{evt.time}</td>
                    <td className="evt-num">×{evt.count}</td>
                    <td className="evt-num">⚡{evt.intensity}</td>
                    <td>
                      <span className={`pct-badge${pct >= 25 ? ' hot' : ''}`}>
                        {pct > 0
                          ? `${pct}%`
                          : <span className="collapsed-badge" title="Схлопнуто">—</span>}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="evt-edit-row">
                      <td colSpan={6}>
                        <EventForm
                          initial={evt}
                          onSave={draft => handleSaveEdit(evt.id, draft)}
                          onCancel={() => setEditingId(null)}
                          onDelete={() => handleDelete(evt.id)}
                          isNew={false}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {editingId === 'new' ? (
        <div className="evt-new-wrap">
          <EventForm
            initial={BLANK}
            onSave={handleSaveNew}
            onCancel={() => setEditingId(null)}
            isNew={true}
          />
        </div>
      ) : (
        <button
          className="btn-primary"
          style={{ marginTop: 8 }}
          onClick={() => setEditingId('new')}
        >
          + Добавить сигнал
        </button>
      )}
    </div>
  )
}
