const CHECKPOINTS = [
  {
    status: 'done',
    title: 'Анализ задания и архитектурные решения',
    body: '— placeholder —',
  },
  {
    status: 'done',
    title: 'Модель расчёта (src/model.js)',
    body: '— placeholder —',
  },
  {
    status: 'done',
    title: 'Юнит-тесты (vitest, 22 кейса)',
    body: '— placeholder —',
  },
  {
    status: 'done',
    title: 'UI: тема Stardew Valley, SVG-карта, панели',
    body: '— placeholder —',
  },
  {
    status: 'todo',
    title: 'FastAPI бэкенд + интеграция Anthropic API',
    body: '— placeholder —',
  },
  {
    status: 'todo',
    title: 'Docker + docker-compose',
    body: '— placeholder —',
  },
  {
    status: 'todo',
    title: 'README и итоговая документация',
    body: '— placeholder —',
  },
]

const STATUS_ICON = { done: '✅', wip: '🚧', todo: '⬜' }

export default function Worklog() {
  return (
    <div className="worklog-panel">
      <div className="section-title">🤖 AI Worklog</div>
      <div className="worklog-subtitle">
        История решений и чекпоинты — заполняется по ходу разработки
      </div>
      <ul className="worklog-list">
        {CHECKPOINTS.map((cp, i) => (
          <li key={i} className={`worklog-item ${cp.status}`}>
            <span className="worklog-icon">{STATUS_ICON[cp.status]}</span>
            <div>
              <div className="worklog-step-title">{cp.title}</div>
              <div className="worklog-step-body">{cp.body}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
