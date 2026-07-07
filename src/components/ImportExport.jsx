import { useState, useRef } from 'react'
import Dropdown from './Dropdown.jsx'

function buildReport(events, rabbits, confidence, contributions, byZone) {
  const evtMap = Object.fromEntries(events.map(e => [e.id, e]))
  const r = Math.round(rabbits * 10) / 10
  const confLabel = confidence >= 70 ? 'уверенно' : confidence >= 40 ? 'предположительно' : 'неточно'
  const verdict = r === 0 ? 'Следов нет' : `${confLabel} около ${r} кр.`

  return {
    generated: new Date().toISOString(),
    summary: { rabbits: r, confidence, verdict },
    by_zone: Object.fromEntries(
      Object.entries(byZone).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    signal_contributions: [...contributions]
      .filter(c => c.percent > 0)
      .sort((a, b) => b.percent - a.percent)
      .map(c => {
        const e = evtMap[c.id]
        return { signal: e?.event ?? '?', location: e?.location ?? '?', percent: c.percent }
      }),
    events,
  }
}

function validateImport(data) {
  if (!Array.isArray(data)) throw new Error('Ожидается массив событий')
  if (data.length === 0) throw new Error('Массив пуст — нечего загружать')
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    const p = `Запись ${i + 1}: `
    if (typeof item.id !== 'string' || !item.id)
      throw new Error(p + 'поле id должно быть строкой')
    if (typeof item.event !== 'string' || !item.event)
      throw new Error(p + 'поле event должно быть строкой')
    if (typeof item.location !== 'string' || !item.location)
      throw new Error(p + 'поле location должно быть строкой')
    if (!Number.isInteger(item.count) || item.count < 1)
      throw new Error(p + 'count должен быть целым числом ≥ 1')
    if (typeof item.intensity !== 'number' || item.intensity < 1 || item.intensity > 10)
      throw new Error(p + 'intensity должен быть числом от 1 до 10')
    if (typeof item.time !== 'string' || !/^\d{2}:\d{2}$/.test(item.time))
      throw new Error(p + 'time должен быть в формате ЧЧ:ММ')
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const FORMAT_OPTIONS = [
  { value: 'events', label: 'События' },
  { value: 'report', label: 'Полный отчёт' },
]

export default function ImportExport({ events, rabbits, confidence, contributions, byZone, onImport }) {
  const [open,           setOpen]           = useState(false)
  const [importError,    setImportError]    = useState(null)
  const [webhookUrl,     setWebhookUrl]     = useState('')
  const [webhookFormat,  setWebhookFormat]  = useState('events')
  const [webhookStatus,  setWebhookStatus]  = useState(null)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const fileRef = useRef()

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result)
        validateImport(data)
        onImport(data)
        setImportError(null)
      } catch (err) {
        setImportError(err.message)
      }
    }
    reader.onerror = () => setImportError('Не удалось прочитать файл')
    reader.readAsText(file)
  }

  async function handleWebhookSend() {
    const url = webhookUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setWebhookStatus({ ok: false, message: 'URL должен начинаться с http:// или https://' })
      return
    }

    setWebhookLoading(true)
    setWebhookStatus(null)

    const payload = webhookFormat === 'events'
      ? events
      : buildReport(events, rabbits, confidence, contributions, byZone)

    try {
      const res = await fetch('/api/webhook', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, report: payload }),
        signal:  AbortSignal.timeout(15000),
      })
      const data = await res.json()
      if (data.ok) {
        setWebhookStatus({ ok: true, message: `Отправлено ✓  (HTTP ${data.status})` })
      } else {
        setWebhookStatus({ ok: false, message: data.error ?? `HTTP ${data.status}` })
      }
    } catch {
      setWebhookStatus({ ok: false, message: 'Ошибка соединения с сервером' })
    } finally {
      setWebhookLoading(false)
    }
  }

  return (
    <div className="import-export-wrap">
      <input type="file" accept=".json" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

      <button className="import-export-toggle" onClick={() => setOpen(o => !o)}>
        <span>📥📤 Импорт / Экспорт</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="import-export-body">
          <div className="ie-buttons">
            <button className="btn-ghost" onClick={() => fileRef.current.click()}>
              📥 Загрузить .json
            </button>
            <button className="btn-ghost" onClick={() => downloadJson(events, 'bunfarm-events.json')}>
              📤 Скачать события
            </button>
            <button className="btn-ghost" onClick={() => downloadJson(buildReport(events, rabbits, confidence, contributions, byZone), 'bunfarm-report.json')}>
              📄 Скачать отчёт
            </button>
          </div>

          {importError && <div className="ie-error">⚠️ {importError}</div>}

          <div className="webhook-section">
            <div className="webhook-label">🌐 Отправить на вебхук</div>
            <input
              type="text"
              className="webhook-url-input"
              placeholder="https://example.com/webhook"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
            />
            <div className="webhook-format-row">
              <span>Формат:</span>
              <Dropdown
                options={FORMAT_OPTIONS}
                value={webhookFormat}
                onChange={setWebhookFormat}
                className="webhook-format-dropdown"
              />
              <button
                className="btn-primary"
                onClick={handleWebhookSend}
                disabled={!webhookUrl.trim() || webhookLoading}
              >
                {webhookLoading ? '…' : 'Отправить'}
              </button>
            </div>
            {webhookStatus && (
              <div className={`webhook-status ${webhookStatus.ok ? 'ok' : 'err'}`}>
                {webhookStatus.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
