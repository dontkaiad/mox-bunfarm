import { useMemo } from 'react'
import { buildFallbackRecs } from '../reportText.js'

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
