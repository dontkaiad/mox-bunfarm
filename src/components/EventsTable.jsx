import React, { useState, useMemo } from 'react'
import { LOCATIONS } from '../data.js'
import Tip from './Tip.jsx'
import Dropdown from './Dropdown.jsx'

const relToSlider  = v => Math.max(1, Math.min(10, Math.round(v * 10)))
const sliderToRel  = v => v / 10
const RPU_MIN = 0.3, RPU_SPAN = 1.7
const rpuToSlider  = v => Math.max(1, Math.min(10, Math.round((v - RPU_MIN) / RPU_SPAN * 9 + 1)))
const sliderToRpu  = v => RPU_MIN + (v - 1) / 9 * RPU_SPAN

const BLANK = { event: 'footprints', location: 'Огород', count: 1, intensity: 5, time: '12:00' }
const SENTINEL_NEW = '__new_custom__'

const CUSTOM_TYPE_ICONS = [
  '🔍','🌿','🦴','🍎','🚜','🕳️','👣','🌾','🥬','🐇','🔔','📷','🌰','🪤','🌻','🐾',
]

function CustomTypeCreator({ onConfirm, onCancel }) {
  const [label,       setLabel]       = useState('')
  const [emoji,       setEmoji]       = useState('🔍')
  const [reliability, setReliability] = useState(0.6)
  const [rpu,         setRpu]         = useState(1.0)

  return (
    <div className="custom-type-creator">
      <div className="custom-type-creator-title">Новый тип сигнала</div>
      <div className="custom-type-creator-fields">
        <label className="evt-form-field evt-form-field-fullwidth">
          <span>Название</span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Например: Следы от клетки"
            maxLength={30}
          />
        </label>
        <div className="evt-form-field evt-form-field-fullwidth">
          <span>Значок</span>
          <div className="icon-picker">
            {CUSTOM_TYPE_ICONS.map(ic => (
              <button
                key={ic}
                type="button"
                className={`icon-option${emoji === ic ? ' selected' : ''}`}
                onClick={() => setEmoji(ic)}
                aria-label={ic}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
        <label className="evt-form-field">
          <span>
            Доверие к сигналу{' '}
            <Tip text="Насколько надёжен этот тип следа. При высоком доверии система берёт сигнал в полную силу." />
          </span>
          <div className="param-slider-row">
            <input
              type="range" min={1} max={10} step={1}
              value={relToSlider(reliability)}
              onChange={e => setReliability(sliderToRel(+e.target.value))}
            />
            <span className="param-slider-val">{relToSlider(reliability)}</span>
          </div>
        </label>
        <label className="evt-form-field">
          <span>
            Кроликов за сигнал{' '}
            <Tip text="Это множитель, а не число кроликов. Итог получается меньше: заметность и доверие уменьшают вклад, а похожие следы рядом схлопываются в одного кролика." />
          </span>
          <div className="param-slider-row">
            <input
              type="range" min={1} max={10} step={1}
              value={rpuToSlider(rpu)}
              onChange={e => setRpu(sliderToRpu(+e.target.value))}
            />
            <span className="param-slider-val">{rpuToSlider(rpu)}</span>
          </div>
        </label>
      </div>
      <div className="evt-form-actions">
        <button
          className="btn-primary"
          type="button"
          onClick={() => label.trim() && onConfirm({ label: label.trim(), emoji, reliability, rpu })}
          disabled={!label.trim()}
        >
          ✓ Создать тип
        </button>
        <button className="btn-ghost" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  )
}

function EventForm({ initial, onSave, onCancel, onDelete, isNew, allEventMeta, allEventTypes, onAddCustomType }) {
  const [draft, setDraft] = useState({ ...initial })
  const [customTypePending, setCustomTypePending] = useState(false)
  const set = (f, v) => setDraft(p => ({ ...p, [f]: v }))

  const typeOptions = useMemo(() => [
    ...allEventTypes.map(t => ({
      value: t,
      label: allEventMeta[t]?.label ?? t,
      emoji: allEventMeta[t]?.emoji ?? '',
    })),
    { divider: true },
    { value: SENTINEL_NEW, label: 'Свой тип…', emoji: '➕' },
  ], [allEventTypes, allEventMeta])

  const locationOptions = useMemo(() =>
    LOCATIONS.map(l => ({ value: l, label: l }))
  , [])

  function handleTypeChange(value) {
    if (value === SENTINEL_NEW) {
      setCustomTypePending(true)
    } else {
      set('event', value)
      setCustomTypePending(false)
    }
  }

  function handleCustomTypeConfirm({ label, emoji, reliability, rpu }) {
    const typeId = `custom_${Date.now()}`
    onAddCustomType({ type: typeId, label, emoji, reliability, rpu })
    set('event', typeId)
    setCustomTypePending(false)
  }

  return (
    <div className="evt-form">
      <div className="evt-form-grid">
        <div className="evt-form-field">
          <span>Тип сигнала</span>
          <Dropdown
            options={typeOptions}
            value={customTypePending ? SENTINEL_NEW : draft.event}
            onChange={handleTypeChange}
          />
        </div>
        <div className="evt-form-field">
          <span>Место</span>
          <Dropdown
            options={locationOptions}
            value={draft.location}
            onChange={v => set('location', v)}
          />
        </div>
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
        <label className="evt-form-field evt-form-field-fullwidth">
          <span>
            Заметность (1–10){' '}
            <Tip text="Насколько чёткий след ты видишь. Явную улику система учитывает сильнее смутного намёка." />
          </span>
          <div className="param-slider-row">
            <input
              type="range" min={1} max={10} step={1}
              value={draft.intensity}
              onChange={e => set('intensity', +e.target.value)}
            />
            <span className="param-slider-val">{draft.intensity}</span>
          </div>
        </label>
      </div>

      {customTypePending ? (
        <CustomTypeCreator
          onConfirm={handleCustomTypeConfirm}
          onCancel={() => setCustomTypePending(false)}
        />
      ) : (
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
      )}
    </div>
  )
}

export default function EventsTable({ events, contributions, onUpdate, onDelete, onAdd, allEventMeta, allEventTypes, onAddCustomType }) {
  const [editingId, setEditingId] = useState(null)
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
      <div className="section-title">📋 Журнал сигналов ({events.length})</div>
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
              const meta   = allEventMeta[evt.event]
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
                        <span>{meta?.label ?? evt.event}</span>
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
                          allEventMeta={allEventMeta}
                          allEventTypes={allEventTypes}
                          onAddCustomType={onAddCustomType}
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
            allEventMeta={allEventMeta}
            allEventTypes={allEventTypes}
            onAddCustomType={onAddCustomType}
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
