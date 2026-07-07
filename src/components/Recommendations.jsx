import { useMemo } from 'react'

function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (events.length === 0) {
    return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  }

  const recs = []

  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) {
    recs.push(`Зона «${topZone[0]}» — самая активная (~${topZone[1].toFixed(1)} кр.). Начните следующий обход отсюда.`)
  }

  if (events.some(e => e.event === 'motion_sensor')) {
    recs.push('Датчик движения сработал — осмотрите сарай, пока следы свежие.')
  }

  if (rabbits > 5) {
    recs.push(`Оценка крупная (~${Math.round(rabbits)} кр.). Установите датчики в зонах без сигналов — возможно, упускаем часть активности.`)
  }

  if (confidence < 50) {
    recs.push('Уверенность низкая. Добавьте сигналы из разных зон и разных типов — это повысит точность оценки.')
  }

  const fpZones = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fpZones.length > 1) {
    recs.push(`Следы в нескольких зонах (${fpZones.join(', ')}) — проверьте переходы между участками.`)
  }

  if ((byZone['Теплица'] ?? 0) > 1) {
    recs.push('⚠️ Теплица: повышенная активность. Осмотрите периметр — найдите, откуда заходят.')
  }

  const weakCount = events.filter(e => e.intensity <= 3).length
  if (weakCount > 0 && weakCount >= events.length / 2) {
    recs.push('Большинство следов слабые (заметность ≤3). Повторите наблюдение в тех же местах для подтверждения.')
  }

  return recs.slice(0, 4)
}

export default function Recommendations({ rabbits, confidence, events, byZone, llmRecs }) {
  const fallbackRecs = useMemo(
    () => buildFallbackRecs(rabbits, confidence, events, byZone),
    [rabbits, confidence, events, byZone]
  )

  const recs  = (Array.isArray(llmRecs) && llmRecs.length > 0) ? llmRecs : fallbackRecs
  const isLlm = recs === llmRecs

  return (
    <div className="recs-panel">
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
  )
}
