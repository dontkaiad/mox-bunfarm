import { useState } from 'react'
import { EVENT_META, EVENT_TYPES } from '../data.js'

const RELIABILITY_PRESETS = [
  { label: 'слабо',  value: 0.3 },
  { label: 'средне', value: 0.6 },
  { label: 'сильно', value: 0.9 },
]

const RPU_PRESETS = [
  { label: 'мало',   value: 0.3 },
  { label: 'средне', value: 1.0 },
  { label: 'много',  value: 2.0 },
]

const MOVEMENT_PRESETS = [
  { label: 'медленно', value: 60 },
  { label: 'средне',   value: 30 },
  { label: 'быстро',   value: 15 },
]

// Returns the preset whose value is closest to `current`
function closestPreset(current, presets) {
  return presets.reduce((best, p) =>
    Math.abs(p.value - current) < Math.abs(best.value - current) ? p : best
  )
}

function PresetGroup({ presets, current, onSelect }) {
  const active = closestPreset(current, presets)
  return (
    <div className="param-preset-group">
      {presets.map(p => (
        <button
          key={p.label}
          className={`preset-btn${active.value === p.value ? ' active' : ''}`}
          onClick={() => onSelect(p.value)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export default function ModelParams({ params, onUpdate, hint }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="model-params-wrap panel">
      <button className="model-params-toggle" onClick={() => setOpen(o => !o)}>
        <span>⚙️ Настройка распознавания</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-params-body">
          {/* Movement window — global param */}
          <div className="param-block">
            <div className="param-type-label">🏃 Как быстро кролики перемещаются по ферме</div>
            <PresetGroup
              presets={MOVEMENT_PRESETS}
              current={params.movementWindowMinutes}
              onSelect={v => onUpdate('movementWindowMinutes', null, v)}
            />
            {hint?.target === 'movementWindowMinutes' && (
              <div className="param-hint">💡 {hint.text}</div>
            )}
          </div>

          {/* Per-signal-type params */}
          {EVENT_TYPES.map(type => {
            const meta = EVENT_META[type]
            const showHint = hint && (
              hint.target === `reliability.${type}` ||
              hint.target === `rabbitsPerUnit.${type}`
            )
            return (
              <div key={type} className="param-block">
                <div className="param-type-label">{meta.emoji} {meta.label}</div>

                <div className="param-row-label">Насколько верить этому сигналу:</div>
                <PresetGroup
                  presets={RELIABILITY_PRESETS}
                  current={params.reliability[type]}
                  onSelect={v => onUpdate('reliability', type, v)}
                />

                <div className="param-row-label">Сколько кроликов за одним сигналом:</div>
                <PresetGroup
                  presets={RPU_PRESETS}
                  current={params.rabbitsPerUnit[type]}
                  onSelect={v => onUpdate('rabbitsPerUnit', type, v)}
                />

                {showHint && <div className="param-hint">💡 {hint.text}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
