import { rabbitRange } from '../rabbitRange.js'

function confClass(c) {
  if (c >= 70) return 'conf-high'
  if (c >= 40) return 'conf-mid'
  return 'conf-low'
}

export default function Header({ rabbits, confidence, explanation }) {
  const cls = confClass(confidence)
  return (
    <header className="header">
      <div className="header-top">
        <div className="header-title">🐰 Ферма невидимых кроликов</div>

        <div className="header-stats">
          <div className="stat-block">
            <span className="stat-label">кроликов примерно</span>
            <span className="stat-value rabbits-value">{rabbitRange(rabbits)}</span>
          </div>

          <div className="stat-block">
            <span className="stat-label">уверенность</span>
            <span className={`stat-value ${cls}`}>{confidence}%</span>
          </div>

        </div>
      </div>

      {explanation && (
        <div className="header-explanation">{explanation}</div>
      )}
      <div className="header-attribution">
        Тестовое задание AI-first Developer · MOX · Карина Ларк
      </div>
    </header>
  )
}
