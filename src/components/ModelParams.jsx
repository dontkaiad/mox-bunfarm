import { useState } from 'react'
import { EVENT_META, EVENT_TYPES } from '../data.js'

export default function ModelParams({ params, onUpdate }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="model-params-wrap panel">
      <button className="model-params-toggle" onClick={() => setOpen(o => !o)}>
        <span>⚙️ Параметры модели</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-params-body">
          {EVENT_TYPES.map(type => {
            const meta = EVENT_META[type]
            const rpu = params.rabbitsPerUnit[type]
            const rel = params.reliability[type]
            return (
              <div key={type} className="param-block">
                <div className="param-type-label">{meta.emoji} {meta.label}</div>
                <div className="param-sliders">
                  <div className="slider-row">
                    <span className="slider-label">Кроликов/ед: {rpu.toFixed(1)}</span>
                    <input
                      type="range" min={0.1} max={5} step={0.1}
                      value={rpu}
                      onChange={e => onUpdate('rabbitsPerUnit', type, +e.target.value)}
                    />
                  </div>
                  <div className="slider-row">
                    <span className="slider-label">Надёжность: {rel.toFixed(2)}</span>
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={rel}
                      onChange={e => onUpdate('reliability', type, +e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
