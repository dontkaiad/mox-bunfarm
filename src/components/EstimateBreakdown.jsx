import { useState, useMemo } from 'react'
import { EVENT_META } from '../data.js'
import { getConfidenceFactors } from '../confidence.js'

// ── Static model explanation (3-step intro) ───────────────────────────────────
function ModelExplanation() {
  const [open, setOpen] = useState(false)
  return (
    <div className="model-explainer">
      <button className="model-explainer-toggle" onClick={() => setOpen(o => !o)}>
        <span>ℹ️ Как устроена оценка</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ol className="model-steps">
          <li>
            <strong>Каждый след превращаем в кроликов:</strong> чем надёжнее сигнал и чем он
            заметнее, тем больше кроликов за ним считаем.
          </li>
          <li>
            <strong>Похожие следы рядом по времени и месту схлопываем</strong> — это один и тот
            же кролик наследил, а не новые.
          </li>
          <li>
            <strong>Складываем оставшееся</strong> — получаем примерную оценку.
          </li>
        </ol>
      )}
    </div>
  )
}

// ── Signal role labels ────────────────────────────────────────────────────────
function signalRole(pct) {
  if (pct >= 35) return { text: 'главный сигнал',  cls: 'role-main' }
  if (pct >= 15) return { text: 'заметный вклад',  cls: 'role-notable' }
  if (pct >= 5)  return { text: 'влияет слабо',    cls: 'role-minor' }
  if (pct >  0)  return { text: 'почти не влияет', cls: 'role-tiny' }
  return               { text: 'дубль',            cls: 'role-dup' }
}

function reliabilityNote(rel) {
  if (rel >= 0.7) return 'доверие высокое'
  if (rel >= 0.5) return 'доверие среднее'
  return 'ненадёжный признак'
}

function buildSignalNote(pct, rel, isCollapsed) {
  if (isCollapsed) return 'уже учтён более сильный сигнал поблизости'
  const relNote = reliabilityNote(rel)
  if (pct >= 35) return `на нём держится бо́льшая часть оценки — ${relNote}`
  if (pct >= 15) return `заметный вклад в итоговую цифру — ${relNote}`
  if (pct >= 5)  return `влияет слабо — ${relNote}`
  return `${relNote}, почти не меняет итог`
}

// ── Confidence factor consequence texts ──────────────────────────────────────
function diversityConsequence(value, uniqueTypes) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return `${uniqueTypes} типа(ов) сигналов — хорошее разнообразие, оценке можно доверять`
  if (pct >= 35) return `${uniqueTypes} типа(ов) — неплохо, но больше видов следов повысит точность`
  return `всего ${uniqueTypes} тип(а) сигналов — мало разнообразия, добавьте больше видов наблюдений`
}

function intensityConsequence(value) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return 'следы чёткие и выраженные — надёжная картина'
  if (pct >= 35) return 'следы умеренной силы'
  return 'следы слабые — возможно, всё почудилось'
}

function consistencyConsequence(value) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return 'активность сосредоточена — система уверена в оценке'
  if (pct >= 35) return 'следы в нескольких зонах — умеренная согласованность'
  return 'следы разбросаны по разным углам фермы — поэтому система не уверена полностью'
}

// ── Factor bar ────────────────────────────────────────────────────────────────
function FactorBar({ label, value, consequence }) {
  const pct = Math.round(value * 100)
  const cls = pct >= 65 ? 'high' : pct >= 35 ? 'mid' : 'low'
  const lvl = pct >= 65 ? 'высокий' : pct >= 35 ? 'средний' : 'низкий'
  return (
    <div className="factor-item">
      <div className="factor-header">
        <span className="factor-label">{label}</span>
        <span className={`factor-level ${cls}`}>{lvl}</span>
      </div>
      <div className="factor-bar-track">
        <div className={`factor-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="factor-consequence">{consequence}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EstimateBreakdown({ rabbits, confidence, contributions, events, params }) {
  const factors     = useMemo(() => getConfidenceFactors(events, params), [events, params])
  const evtMap      = useMemo(() => Object.fromEntries(events.map(e => [e.id, e])), [events])
  const uniqueTypes = useMemo(() => new Set(events.map(e => e.event)).size, [events])
  const totalValue  = useMemo(() => contributions.reduce((s, c) => s + c.value, 0), [contributions])

  // All role/note fields are pure functions of contributions+params — recompute on every change
  const ranked = useMemo(() => {
    return [...contributions]
      .sort((a, b) => b.value - a.value)
      .map(c => {
        const evt = evtMap[c.id]
        if (!evt) return null
        const meta        = EVENT_META[evt.event]
        const isCollapsed = c.percent === 0
        const pct         = isCollapsed ? 0 : Math.round((c.value / (totalValue || 1)) * 100)
        const role        = signalRole(pct)
        const rel         = params.reliability[evt.event] ?? 0.5
        const note        = buildSignalNote(pct, rel, isCollapsed)
        return { ...c, evt, meta, isCollapsed, pct, role, note }
      })
      .filter(Boolean)
  }, [contributions, evtMap, totalValue, params])

  return (
    <div className="breakdown-body">

      <ModelExplanation />

      <div className="breakdown-sections">

        {/* ── Signal ranking ── */}
        <div className="breakdown-section">
          <div className="breakdown-section-title">Вклад каждого сигнала</div>
          {ranked.length === 0 ? (
            <p className="breakdown-empty">Нет данных</p>
          ) : (
            <ul className="bd-signal-list">
              {ranked.map(item => (
                <li key={item.id} className={`bd-signal-item${item.isCollapsed ? ' dim' : ''}`}>
                  <div className="bd-signal-top">
                    <span className="bd-emoji">{item.meta?.emoji}</span>
                    <span className="bd-name">
                      {item.meta?.label}
                      <span className="bd-location"> ({item.evt.location})</span>
                    </span>
                    <span className={`bd-role ${item.role.cls}`}>{item.role.text}</span>
                  </div>
                  {!item.isCollapsed && (
                    <div className="bd-signal-bottom">
                      <div className="bd-share-track">
                        <div className={`bd-share-fill ${item.role.cls}`}
                             style={{ width: `${item.pct}%` }} />
                      </div>
                      <span className="bd-signal-note">{item.note}</span>
                    </div>
                  )}
                  {item.isCollapsed && (
                    <div className="bd-signal-note bd-dup-note">{item.note}</div>
                  )}
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
            consequence={diversityConsequence(factors.diversity, uniqueTypes)}
          />
          <FactorBar
            label="Сила следов"
            value={factors.avgIntensity}
            consequence={intensityConsequence(factors.avgIntensity)}
          />
          <FactorBar
            label="Согласованность по зонам"
            value={factors.consistency}
            consequence={consistencyConsequence(factors.consistency)}
          />
        </div>

      </div>
    </div>
  )
}
