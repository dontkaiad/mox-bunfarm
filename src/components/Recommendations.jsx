import { useMemo } from 'react'
import { EVENT_META } from '../data.js'

function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (events.length === 0) {
    return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  }

  const recs = []

  // Most active zone — go check there first
  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) {
    recs.push(`Зона «${topZone[0]}» — самая активная (~${topZone[1].toFixed(1)} кр.). Начните следующий обход отсюда.`)
  }

  // Motion sensor fired — high-quality signal, go look while evidence is fresh
  if (events.some(e => e.event === 'motion_sensor')) {
    recs.push('Датчик движения сработал — осмотрите сарай, пока следы свежие.')
  }

  // Large estimate — silent zones need sensors to confirm scope
  if (rabbits > 5) {
    recs.push(`Оценка крупная (~${Math.round(rabbits)} кр.). Установите датчики в зонах без сигналов — возможно, упускаем часть активности.`)
  }

  // Low confidence — need more diverse or stronger signals
  if (confidence < 50) {
    recs.push('Уверенность низкая. Добавьте сигналы из разных зон и разных типов — это повысит точность оценки.')
  }

  // Footprints in multiple zones — track the movement corridor
  const fpZones = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fpZones.length > 1) {
    recs.push(`Следы в нескольких зонах (${fpZones.join(', ')}) — проверьте переходы между участками.`)
  }

  // Greenhouse activity — check entry points
  if ((byZone['Теплица'] ?? 0) > 1) {
    recs.push('⚠️ Теплица: повышенная активность. Осмотрите периметр — найдите, откуда заходят.')
  }

  // Mostly weak signals — need confirmation before trusting the estimate
  const weakCount = events.filter(e => e.intensity <= 3).length
  if (weakCount > 0 && weakCount >= events.length / 2) {
    recs.push('Большинство следов слабые (заметность ≤3). Повторите наблюдение в тех же местах для подтверждения.')
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
