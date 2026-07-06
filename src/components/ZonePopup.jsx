import { EVENT_META } from '../data.js'
import { rabbitRange } from '../rabbitRange.js'

export default function ZonePopup({ zone, events, estimate, contributions, onClose }) {
  const pctMap = Object.fromEntries(contributions.map(c => [c.id, c.percent]))

  return (
    <div className="zone-popup">
      <div className="popup-header">
        <span>📍 {zone}</span>
        <button className="popup-close" onClick={onClose} title="Закрыть">✕</button>
      </div>

      <div className="popup-estimate">
        {rabbitRange(estimate)} 🐰 в этой зоне
      </div>

      {events.length === 0 ? (
        <div className="popup-empty">Нет зарегистрированных сигналов</div>
      ) : (
        <ul className="popup-events">
          {events.map(evt => {
            const meta = EVENT_META[evt.event]
            const pct  = pctMap[evt.id] ?? 0
            return (
              <li key={evt.id} className="popup-evt-row">
                <span>{meta?.emoji}</span>
                <span>{meta?.label}</span>
                <span className="popup-muted">{evt.time}</span>
                <span className="popup-muted">×{evt.count}</span>
                <span className="popup-muted" title="Интенсивность">⚡{evt.intensity}</span>
                <span className={`pct-badge${pct >= 20 ? ' hot' : ''}`}>
                  {pct > 0 ? `${pct}%` : <span className="collapsed-badge">—</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
