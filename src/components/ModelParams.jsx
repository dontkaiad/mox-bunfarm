import { useState } from 'react'
import Tip from './Tip.jsx'

// Reliability: stored 0–1, slider 1–10 (0.3→3, 0.6→6, 0.9→9)
const relToSlider  = v => Math.max(1, Math.min(10, Math.round(v * 10)))
const sliderToRel  = v => v / 10

// RabbitsPerUnit: stored 0.3–2.0, slider 1–10 (0.3→1, ≈1.0→5, 2.0→10)
const RPU_MIN = 0.3, RPU_SPAN = 1.7
const rpuToSlider  = v => Math.max(1, Math.min(10, Math.round((v - RPU_MIN) / RPU_SPAN * 9 + 1)))
const sliderToRpu  = v => RPU_MIN + (v - 1) / 9 * RPU_SPAN

const MOVEMENT_PRESETS = [
  { label: 'медленно', value: 60 },
  { label: 'средне',   value: 30 },
  { label: 'быстро',   value: 15 },
]

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

function ParamSlider({ value, onChange, toSlider, fromSlider }) {
  const sv = toSlider(value)
  return (
    <div className="param-slider-row">
      <input
        type="range" min={1} max={10} step={1}
        value={sv}
        onChange={e => onChange(fromSlider(+e.target.value))}
      />
      <span className="param-slider-val">{sv}</span>
    </div>
  )
}

export default function ModelParams({ params, onUpdate, hint, eventMeta, eventTypes }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="model-params-wrap panel">
      <button className="model-params-toggle" onClick={() => setOpen(o => !o)}>
        <span>⚙️ Настройка модели</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-params-body">
          {/* Movement window — categorical, stays as 3-preset */}
          <div className="param-block">
            <div className="param-type-label">
              🏃 Скорость перемещения{' '}
              <Tip text="Если два следа в разных местах появились близко по времени — возможно, один кролик. Чем быстрее — тем строже объединяем." />
            </div>
            <PresetGroup
              presets={MOVEMENT_PRESETS}
              current={params.movementWindowMinutes}
              onSelect={v => onUpdate('movementWindowMinutes', null, v)}
            />
            {hint?.target === 'movementWindowMinutes' && (
              <div className="param-hint">💡 {hint.text}</div>
            )}
          </div>

          {/* Per-signal-type sliders */}
          {eventTypes.map(type => {
            const meta = eventMeta[type]
            const showHint = hint && (
              hint.target === `reliability.${type}` ||
              hint.target === `rabbitsPerUnit.${type}`
            )
            return (
              <div key={type} className="param-block">
                <div className="param-type-label">{meta.emoji} {meta.label}</div>

                <div className="param-row-label">
                  Доверие к сигналу{' '}
                  <Tip text="Насколько надёжен этот тип следа. При высоком доверии система берёт сигнал в полную силу." />
                </div>
                <ParamSlider
                  value={params.reliability[type]}
                  onChange={v => onUpdate('reliability', type, v)}
                  toSlider={relToSlider}
                  fromSlider={sliderToRel}
                />

                <div className="param-row-label">
                  Кроликов за сигнал{' '}
                  <Tip text="Это множитель, а не число кроликов. Итог получается меньше: заметность и доверие уменьшают вклад, а похожие следы рядом схлопываются в одного кролика." />
                </div>
                <ParamSlider
                  value={params.rabbitsPerUnit[type]}
                  onChange={v => onUpdate('rabbitsPerUnit', type, v)}
                  toSlider={rpuToSlider}
                  fromSlider={sliderToRpu}
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
