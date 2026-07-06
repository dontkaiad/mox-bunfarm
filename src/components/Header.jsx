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
            <span className="stat-value rabbits-value">{rabbits.toFixed(1)}</span>
          </div>

          <div className="stat-block">
            <span className="stat-label">уверенность</span>
            <span className={`stat-value ${cls}`}>{confidence}%</span>
          </div>

          <div className="confidence-bar-wrap">
            <div className="confidence-bar-label">уверенность в оценке</div>
            <div className="confidence-bar-track">
              <div
                className={`confidence-bar-fill ${cls}`}
                style={{ width: `${confidence}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {explanation && (
        <div className="header-explanation">{explanation}</div>
      )}
    </header>
  )
}
