// PDF report generation — lazy-loaded via dynamic import from ImportExport
// to keep jsPDF + html2canvas (~450 KB) out of the initial bundle.
import { jsPDF }     from 'jspdf'
import html2canvas   from 'html2canvas'
import { getConfidenceFactors }     from './confidence.js'
import {
  signalRole, buildSignalNote,
  diversityConsequence, intensityConsequence, consistencyConsequence,
  buildFallbackRecs,
} from './reportText.js'

// jsPDF's html plugin looks for html2canvas in window/globalThis
if (typeof window !== 'undefined') window.html2canvas = html2canvas

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate() {
  const d = new Date()
  const months = ['января','февраля','марта','апреля','мая','июня',
                  'июля','августа','сентября','октября','ноября','декабря']
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`
}

function factorLevelText(v) {
  return v >= 0.65 ? 'высокий' : v >= 0.35 ? 'средний' : 'низкий'
}
function factorColor(v) {
  return v >= 0.65 ? '#3d8b40' : v >= 0.35 ? '#c07800' : '#b03000'
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Rank signals (mirrors EstimateBreakdown) ──────────────────────────────────

function buildRanked({ events, contributions, eventMeta, params }) {
  const evtMap     = Object.fromEntries(events.map(e => [e.id, e]))
  const totalValue = contributions.reduce((s, c) => s + c.value, 0)
  return [...contributions]
    .sort((a, b) => b.value - a.value)
    .map(c => {
      const evt = evtMap[c.id]
      if (!evt) return null
      const meta        = eventMeta[evt.event]
      const isCollapsed = c.percent === 0
      const pct         = isCollapsed ? 0 : Math.round((c.value / (totalValue || 1)) * 100)
      const rel         = params.reliability[evt.event] ?? 0.5
      return { c, evt, meta, isCollapsed, pct, role: signalRole(pct), note: buildSignalNote(pct, rel, isCollapsed) }
    })
    .filter(Boolean)
}

// ── HTML template ─────────────────────────────────────────────────────────────

const S = {
  root:  'font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#2d2d2d;background:white;width:680px;line-height:1.45;',
  h1:    'font-size:20px;font-weight:bold;color:#5c3319;margin:0 0 3px 0;',
  ts:    'font-size:11px;color:#999;margin:0;',
  rule:  'border:none;border-top:3px solid #5c3319;margin:10px 0 16px;',
  box:   'background:#f9f3e8;border:1px solid #c8a070;border-left:5px solid #5c3319;border-radius:3px;padding:12px 16px;margin-bottom:22px;',
  boxH:  'font-size:17px;font-weight:bold;color:#3d1f00;margin:0 0 5px 0;',
  boxSub:'color:#5c3319;margin:0 0 5px 0;font-size:13px;',
  boxZn: 'font-size:11px;color:#888;margin:0;',
  secH:  'font-size:14px;font-weight:bold;color:#5c3319;border-bottom:2px solid #c8a070;padding-bottom:4px;margin:0 0 12px 0;',
  th:    'text-align:left;padding:5px 7px;border:1px solid #c8a070;background:#f0e0c0;color:#5c3319;font-weight:bold;',
  tdL:   'padding:4px 7px;border:1px solid #e0d0b0;vertical-align:middle;',
  tdC:   'padding:4px 7px;border:1px solid #e0d0b0;vertical-align:middle;text-align:center;',
  sec:   'margin-bottom:22px;',
  rec:   'display:flex;gap:8px;padding:6px 10px;background:#faf5ec;border:1px solid #e0c888;border-radius:3px;margin-bottom:6px;font-size:12px;',
}

function section(title, content) {
  return `<div style="${S.sec}"><div style="${S.secH}">${escHtml(title)}</div>${content}</div>`
}

function factorRow(label, value, text) {
  const pct   = Math.round(value * 100)
  const color = factorColor(value)
  const level = factorLevelText(value)
  return `
    <div style="margin-bottom:10px;">
      <div style="display:table;width:100%;margin-bottom:3px;">
        <span style="display:table-cell;font-size:12px;">${escHtml(label)}</span>
        <span style="display:table-cell;text-align:right;font-size:11px;color:${color};">${level} (${pct}%)</span>
      </div>
      <div style="background:#e8d8c0;height:6px;border-radius:3px;overflow:hidden;margin-bottom:3px;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
      </div>
      <div style="font-size:11px;color:#666;font-style:italic;">${escHtml(text)}</div>
    </div>`
}

function buildReportHtml(data) {
  const { events, rabbits, confidence, contributions, byZone,
          params, eventMeta, explanation, llmRecs } = data

  const pctMap      = Object.fromEntries(contributions.map(c => [c.id, c.percent]))
  const uniqueTypes = new Set(events.map(e => e.event)).size
  const factors     = getConfidenceFactors(events, params)
  const ranked      = buildRanked({ events, contributions, eventMeta, params })

  const r        = Math.round(rabbits * 10) / 10
  const confWord = confidence >= 70 ? 'высокая' : confidence >= 40 ? 'средняя' : 'низкая'

  const byZoneStr = Object.entries(byZone)
    .filter(([, v]) => v > 0.05)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${escHtml(k)}: ~${Math.round(v * 10) / 10}`)
    .join(' · ')

  // ── Summary box ──
  const summaryBox = `
    <div style="${S.box}">
      <p style="${S.boxH}">~${r} кр., уверенность ${confidence}% (${confWord})</p>
      <p style="${S.boxSub}">${escHtml(explanation)}</p>
      ${byZoneStr ? `<p style="${S.boxZn}">По зонам: ${byZoneStr}</p>` : ''}
    </div>`

  // ── Events table ──
  const trBg = (i) => i % 2 === 0 ? '' : 'background:#fdf8f0;'
  const evtRows = events.map((evt, i) => {
    const meta = eventMeta[evt.event]
    const pct  = pctMap[evt.id] ?? 0
    return `
      <tr style="${trBg(i)}">
        <td style="${S.tdL}">${escHtml(meta?.emoji ?? '')} ${escHtml(meta?.label ?? evt.event)}</td>
        <td style="${S.tdL}">${escHtml(evt.location)}</td>
        <td style="${S.tdC}">${escHtml(evt.time)}</td>
        <td style="${S.tdC}">×${evt.count}</td>
        <td style="${S.tdC}">${evt.intensity}/10</td>
        <td style="${S.tdC}">${pct > 0 ? pct + '%' : '—'}</td>
      </tr>`
  }).join('')

  const eventsTable = `
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr>
          <th style="${S.th}">Сигнал</th>
          <th style="${S.th}">Место</th>
          <th style="${S.th}text-align:center;">Время</th>
          <th style="${S.th}text-align:center;">Сколько</th>
          <th style="${S.th}text-align:center;">Заметность</th>
          <th style="${S.th}text-align:center;">Вклад</th>
        </tr>
      </thead>
      <tbody>${evtRows}</tbody>
    </table>`

  // ── Signal breakdown ──
  const roleColors = {
    'role-main':    '#b03000',
    'role-notable': '#5c3319',
    'role-minor':   '#7a5235',
    'role-tiny':    '#aaa',
    'role-dup':     '#bbb',
  }

  const breakdownItems = ranked.length === 0
    ? '<p style="color:#888;font-size:11px;font-style:italic;">Нет данных</p>'
    : ranked.map(item => `
      <div style="padding:7px 0;border-bottom:1px solid #e8d8c0;">
        <div style="display:table;width:100%;">
          <span style="display:table-cell;font-weight:bold;font-size:12px;">
            ${escHtml(item.meta?.emoji ?? '')} ${escHtml(item.meta?.label ?? item.evt.event)}
            <span style="font-weight:normal;color:#888;font-size:11px;"> (${escHtml(item.evt.location)})</span>
          </span>
          <span style="display:table-cell;text-align:right;font-size:11px;color:${roleColors[item.role.cls] ?? '#888'};">
            ${escHtml(item.role.text)}
          </span>
        </div>
        <div style="font-size:11px;color:#666;font-style:italic;padding-left:18px;margin-top:2px;">
          ${escHtml(item.note)}
        </div>
      </div>`
    ).join('')

  // ── Confidence factors ──
  const confidenceFactors =
    factorRow('Разнообразие сигналов',   factors.diversity,     diversityConsequence(factors.diversity, uniqueTypes)) +
    factorRow('Сила следов',             factors.avgIntensity,  intensityConsequence(factors.avgIntensity)) +
    factorRow('Согласованность по зонам', factors.consistency,  consistencyConsequence(factors.consistency))

  // ── Recommendations ──
  const recs     = (Array.isArray(llmRecs) && llmRecs.length > 0)
    ? llmRecs
    : buildFallbackRecs(rabbits, confidence, events, byZone)
  const isLlm    = Array.isArray(llmRecs) && llmRecs.length > 0
  const recsNote = `<p style="font-size:11px;color:#888;margin:0 0 10px;font-style:italic;">${
    isLlm ? '✨ Рекомендации от AI (Anthropic claude-haiku)' : 'ℹ️ Рекомендации на основе данных — AI недоступен'
  }</p>`
  const recsItems = recs.map(r => `
    <div style="${S.rec}">
      <span style="color:#c07800;flex-shrink:0;">→</span>
      <span>${escHtml(r)}</span>
    </div>`
  ).join('')

  // ── Assemble ──
  return `
    <div style="${S.root}">
      <h1 style="${S.h1}">🐇 BunFarm — Отчёт об активности кроликов</h1>
      <p style="${S.ts}">${fmtDate()}</p>
      <hr style="${S.rule}">
      ${summaryBox}
      ${section('Журнал сигналов', eventsTable)}
      ${section('Вклад каждого сигнала', breakdownItems)}
      ${section(`Уверенность ${confidence}%`, confidenceFactors)}
      ${section('Рекомендации', recsNote + recsItems)}
    </div>`
}

// ── Public entry ─────────────────────────────────────────────────────────────

export async function downloadPdfReport(data) {
  const html = buildReportHtml(data)

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;background:white;'
  container.innerHTML     = html
  document.body.appendChild(container)

  try {
    // Use html2canvas directly so the browser renders fonts (including Cyrillic)
    // rather than jsPDF's built-in Latin-only fonts.
    const el     = container.firstElementChild
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })

    const imgData  = canvas.toDataURL('image/png')
    const doc      = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    const pageW    = doc.internal.pageSize.getWidth()
    const pageH    = doc.internal.pageSize.getHeight()
    const margin   = 10
    const usableW  = pageW - margin * 2
    const imgH     = (canvas.height / canvas.width) * usableW
    const pageCount = Math.ceil(imgH / (pageH - margin * 2))

    for (let i = 0; i < pageCount; i++) {
      if (i > 0) doc.addPage()
      const srcY   = i * (pageH - margin * 2) * (canvas.width / usableW)
      const srcH   = Math.min((pageH - margin * 2) * (canvas.width / usableW), canvas.height - srcY)
      const sliceH = srcH * (usableW / canvas.width)

      const slice  = document.createElement('canvas')
      slice.width  = canvas.width
      slice.height = srcH
      slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)
      doc.addImage(slice.toDataURL('image/png'), 'PNG', margin, margin, usableW, sliceH)
    }

    doc.save('bunfarm-report.pdf')
  } finally {
    document.body.removeChild(container)
  }
}
