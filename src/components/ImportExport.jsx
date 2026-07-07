import { useState, useRef } from 'react'
import Dropdown from './Dropdown.jsx'
import Tip from './Tip.jsx'

function buildEventsJson(events) {
  return JSON.stringify(events, null, 2)
}

function downloadBlob(content, filename) {
  const blob = new Blob([content], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

const FORMAT_OPTIONS = [
  { value: 'events', label: 'События' },
  { value: 'report', label: 'Полный отчёт' },
]

export default function ImportExport({
  events, rabbits, confidence, contributions, byZone,
  params, eventMeta, llmRecs, explanation,
  onImport,
}) {
  const [showSend,    setShowSend]    = useState(false)
  const [importError, setImportError] = useState(null)
  const [sendUrl,     setSendUrl]     = useState('')
  const [sendFormat,  setSendFormat]  = useState('events')
  const [sendStatus,  setSendStatus]  = useState(null)
  const [sendLoading, setSendLoading] = useState(false)
  const [pdfLoading,  setPdfLoading]  = useState(false)
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

  async function handleDownloadPdf() {
    setPdfLoading(true)
    try {
      const { downloadPdfReport } = await import('../pdfReport.js')
      await downloadPdfReport({ events, rabbits, confidence, contributions, byZone, params, eventMeta, llmRecs, explanation })
    } catch (err) {
      console.error('PDF generation failed:', err)
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleSend() {
    const url = sendUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setSendStatus({ ok: false, message: 'Ссылка должна начинаться с http:// или https://' })
      return
    }

    setSendLoading(true)
    setSendStatus(null)

    const payload = sendFormat === 'events' ? events : { events, rabbits, confidence, byZone }

    try {
      const res = await fetch('/api/webhook', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, report: payload }),
        signal:  AbortSignal.timeout(15000),
      })
      const data = await res.json()
      setSendStatus(data.ok
        ? { ok: true,  message: `Отправлено ✓  (HTTP ${data.status})` }
        : { ok: false, message: data.error ?? `HTTP ${data.status}` }
      )
    } catch {
      setSendStatus({ ok: false, message: 'Ошибка соединения с сервером' })
    } finally {
      setSendLoading(false)
    }
  }

  return (
    <div className="ie-root">
      <input type="file" accept=".json" ref={fileRef} style={{ display: 'none' }} onChange={handleFile} />

      <div className="ie-section-title">📥📤 Экспорт данных</div>

      <div className="ie-actions">
        <button className="btn-primary ie-btn" onClick={() => fileRef.current.click()}>
          📥 Загрузить .json
        </button>
        <button className="btn-primary ie-btn" onClick={() => downloadBlob(buildEventsJson(events), 'bunfarm-events.json')}>
          📤 Скачать события
        </button>
        <button
          className="btn-primary ie-btn"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
        >
          {pdfLoading ? '…' : '📄 Скачать отчёт'}
        </button>
      </div>

      {importError && <div className="ie-error">⚠️ {importError}</div>}

      <div className="ie-send-header">
        <button className="ie-send-toggle" onClick={() => setShowSend(o => !o)}>
          <span>🌐 Отправить отчёт по ссылке</span>
          <span className="ie-send-arrow">{showSend ? '▲' : '▼'}</span>
        </button>
        <Tip text="Отчёт уйдёт POST-запросом на указанный адрес — удобно, чтобы передать данные в другую систему." />
      </div>

      {showSend && (
        <div className="ie-send-body">
          <label className="ie-field-label">Ссылка для отправки отчёта</label>
          <input
            type="text"
            className="webhook-url-input"
            placeholder="https://example.com/hook"
            value={sendUrl}
            onChange={e => setSendUrl(e.target.value)}
          />
          <div className="webhook-format-row">
            <span>Формат:</span>
            <Dropdown
              options={FORMAT_OPTIONS}
              value={sendFormat}
              onChange={setSendFormat}
              className="webhook-format-dropdown"
            />
            <button
              className="btn-primary ie-btn"
              onClick={handleSend}
              disabled={!sendUrl.trim() || sendLoading}
            >
              {sendLoading ? '…' : 'Отправить'}
            </button>
          </div>
          {sendStatus && (
            <div className={`webhook-status ${sendStatus.ok ? 'ok' : 'err'}`}>
              {sendStatus.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
