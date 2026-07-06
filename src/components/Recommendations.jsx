import { useMemo } from 'react'
import { EVENT_META } from '../data.js'

function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (events.length === 0) {
    return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  }

  const recs = []

  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) {
    recs.push(`Зона «${topZone[0]}» наиболее активна (~${topZone[1].toFixed(1)} кр.). Начните обход отсюда.`)
  }

  if (events.some(e => e.event === 'motion_sensor')) {
    recs.push('Датчик движения сработал — расставьте ловушки рядом с сараем в течение ближайших часов.')
  }

  if (rabbits > 5) {
    recs.push(`Оценка крупная (~${rabbits.toFixed(1)} кр.). Одних ловушек мало — рассмотрите сетчатый забор по периметру.`)
  } else if (rabbits > 2) {
    recs.push('Небольшая группа. 2–3 гуманные ловушки по периметру должно хватить.')
  }

  if (confidence < 50) {
    recs.push('Уверенность низкая. Добавьте сигналы из разных зон — разнообразие источников повышает точность.')
  }

  const fpZones = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fpZones.length > 1) {
    recs.push('Следы найдены в нескольких зонах — кролики активно перемещаются. Осмотрите переходы между участками.')
  }

  if ((byZone['Теплица'] ?? 0) > 1) {
    recs.push('⚠️ Теплица под угрозой! Проверьте и укрепите входы — потери урожая возможны.')
  }

  return recs.slice(0, 4)
}

export default function Recommendations({ rabbits, confidence, events, byZone, contributions, llmRecs }) {
  const fallbackRecs = useMemo(
    () => buildFallbackRecs(rabbits, confidence, events, byZone),
    [rabbits, confidence, events, byZone]
  )

  // llmRecs is a non-empty array when the backend responded with source==="llm"
  const recs    = (Array.isArray(llmRecs) && llmRecs.length > 0) ? llmRecs : fallbackRecs
  const isLlm   = recs === llmRecs

  const sorted  = useMemo(
    () => [...contributions].sort((a, b) => b.percent - a.percent),
    [contributions]
  )

  const evtMap = Object.fromEntries(events.map(e => [e.id, e]))

  return (
    <div className="recs-panel">
      <div>
        <div className="section-title">🧙 Рекомендации</div>
        <div className="recs-note">
          {isLlm
            ? '✨ Рекомендации от AI (Anthropic claude-haiku)'
            : 'ℹ️ Правила на основе данных — AI недоступен'}
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
                    <div className="contrib-bar-fill" style={{ width: `${c.percent}%` }} />
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
