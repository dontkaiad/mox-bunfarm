import { useMemo } from 'react'
import { EVENT_META } from '../data.js'

// Rule-based fallback recommendations (Phase 3 replaces this with LLM output)
function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (events.length === 0) {
    return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  }

  const recs = []

  // Most active zone
  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) {
    recs.push(
      `Зона «${topZone[0]}» наиболее активна (~${topZone[1].toFixed(1)} кр.). Начните обход отсюда.`
    )
  }

  // Motion sensor fired
  if (events.some(e => e.event === 'motion_sensor')) {
    recs.push('Датчик движения сработал — расставьте ловушки рядом с сараем в течение ближайших часов.')
  }

  // Large colony
  if (rabbits > 5) {
    recs.push(
      `Оценка крупная (~${rabbits.toFixed(1)} кр.). Одних ловушек мало — рассмотрите сетчатый забор по периметру.`
    )
  } else if (rabbits > 2) {
    recs.push('Небольшая группа. 2–3 гуманные ловушки по периметру должно хватить.')
  }

  // Low confidence
  if (confidence < 50) {
    recs.push('Уверенность низкая. Добавьте сигналы из разных зон — разнообразие источников повышает точность.')
  }

  // Footprints in multiple zones
  const fpZones = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fpZones.length > 1) {
    recs.push('Следы найдены в нескольких зонах — кролики активно перемещаются. Осмотрите переходы между участками.')
  }

  // Greenhouse high activity
  if ((byZone['Теплица'] ?? 0) > 1) {
    recs.push('⚠️ Теплица под угрозой! Проверьте и укрепите входы — потери урожая возможны.')
  }

  return recs.slice(0, 4)
}

export default function Recommendations({ rabbits, confidence, events, byZone, contributions }) {
  const recs = useMemo(
    () => buildFallbackRecs(rabbits, confidence, events, byZone),
    [rabbits, confidence, events, byZone]
  )

  // Sort contributions descending, skip truly-zero entries only when all are zero
  const sorted = useMemo(
    () => [...contributions].sort((a, b) => b.percent - a.percent),
    [contributions]
  )

  const evtMap = Object.fromEntries(events.map(e => [e.id, e]))

  return (
    <div className="recs-panel">
      {/* Recommendations */}
      <div>
        <div className="section-title">🧙 Рекомендации</div>
        <div className="recs-note">
          ℹ️ Правила на основе данных — AI-режим (Anthropic) появится в Phase 3
        </div>
        <ul className="recs-list">
          {recs.map((r, i) => (
            <li key={i} className="rec-item">
              <span className="rec-arrow">→</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Signal contributions ranking */}
      <div>
        <div className="section-title">📊 Вклад сигналов в оценку</div>
        {sorted.length === 0 ? (
          <div className="empty-state">Нет активных сигналов</div>
        ) : (
          <ul className="contribs-list">
            {sorted.map(c => {
              const e = evtMap[c.id]
              if (!e) return null
              const meta = EVENT_META[e.event]
              const collapsed = c.percent === 0
              return (
                <li key={c.id} className="contrib-item">
                  <span>{meta?.emoji}</span>
                  <span style={{ color: collapsed ? 'var(--text-muted)' : 'inherit' }}>
                    {meta?.label} · {e.location}
                  </span>
                  <div className="contrib-bar-track">
                    <div
                      className="contrib-bar-fill"
                      style={{ width: `${c.percent}%` }}
                    />
                  </div>
                  <span className={`contrib-pct${collapsed ? ' dim' : ''}`}>
                    {collapsed
                      ? <span className="collapsed-badge" title="Схлопнуто — учтён более сильный сигнал в той же зоне">—</span>
                      : `${c.percent}%`
                    }
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
