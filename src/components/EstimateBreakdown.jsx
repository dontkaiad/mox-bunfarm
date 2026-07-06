import { useMemo } from 'react'
import { EVENT_META } from '../data.js'
import { getConfidenceFactors, FACTOR_WEIGHTS } from '../confidence.js'

function signalDesc(rabbitsForSignal, isCollapsed) {
  if (isCollapsed) return 'дубль — учтён более сильный сигнал поблизости'
  if (rabbitsForSignal >= 1.5) return 'сильный сигнал'
  if (rabbitsForSignal >= 0.5) return 'умеренный'
  return 'слабый, почти не влияет'
}

function FactorBar({ label, value, weight }) {
  const pct   = Math.round(value * 100)
  const cls   = pct >= 65 ? 'high' : pct >= 35 ? 'mid' : 'low'
  const level = pct >= 65 ? 'высокий' : pct >= 35 ? 'средний' : 'низкий'
  return (
    <div className="factor-row">
      <span className="factor-label">{label}</span>
      <div className="factor-bar-track">
        <div className={`factor-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`factor-level ${cls}`}>{level}</span>
      <span className="factor-weight">вес {weight}%</span>
    </div>
  )
}

export default function EstimateBreakdown({ rabbits, confidence, contributions, events, params }) {
  const factors = useMemo(() => getConfidenceFactors(events, params), [events, params])
  const evtMap  = useMemo(() => Object.fromEntries(events.map(e => [e.id, e])), [events])

  const totalValue = useMemo(
    () => contributions.reduce((s, c) => s + c.value, 0),
    [contributions]
  )

  const ranked = useMemo(() => {
    return [...contributions]
      .sort((a, b) => b.value - a.value)
      .map(c => {
        const evt = evtMap[c.id]
        if (!evt) return null
        const meta = EVENT_META[evt.event]
        const rabbitsForSignal = totalValue > 0 ? (c.value / totalValue) * rabbits : 0
        return { ...c, evt, meta, rabbitsForSignal, isCollapsed: c.percent === 0 }
      })
      .filter(Boolean)
  }, [contributions, evtMap, rabbits, totalValue])

  return (
    <div className="breakdown-body">

      {/* ── Signal ranking ── */}
      <div className="breakdown-section">
        <div className="breakdown-section-title">Вклад каждого сигнала</div>
        {ranked.length === 0 ? (
          <p className="breakdown-empty">Нет данных</p>
        ) : (
          <ul className="breakdown-list">
            {ranked.map(item => (
              <li key={item.id} className={`breakdown-row${item.isCollapsed ? ' dim' : ''}`}>
                <span className="bd-emoji">{item.meta?.emoji}</span>
                <span className="bd-name">
                  {item.meta?.label}
                  <span className="bd-location">&nbsp;({item.evt.location})</span>
                </span>
                <span className="bd-value">
                  {item.isCollapsed
                    ? <span className="bd-zero">—</span>
                    : `+${item.rabbitsForSignal.toFixed(2)} 🐰`}
                </span>
                <span className="bd-desc">{signalDesc(item.rabbitsForSignal, item.isCollapsed)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Confidence factor breakdown ── */}
      <div className="breakdown-section">
        <div className="breakdown-section-title">
          Из чего складывается уверенность {confidence}%
        </div>
        <FactorBar
          label="Разнообразие сигналов"
          value={factors.diversity}
          weight={FACTOR_WEIGHTS.diversity}
        />
        <FactorBar
          label="Сила следов"
          value={factors.avgIntensity}
          weight={FACTOR_WEIGHTS.intensity}
        />
        <FactorBar
          label="Согласованность по зонам"
          value={factors.consistency}
          weight={FACTOR_WEIGHTS.consistency}
        />
      </div>

    </div>
  )
}
