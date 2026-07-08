import { DEFAULT_PARAMS, calculateRabbits, calculateConfidence, calculateByZone, calculateContributions, latestEventTime } from './model.js'
import { INITIAL_EVENTS, EVENT_META, EVENT_TYPES, LOCATIONS } from './data.js'
import { rabbitRange } from './rabbitRange.js'
import { buildSubtitle } from './explainer.js'
import { getConfidenceFactors } from './confidence.js'

// ── constants ──────────────────────────────────────────────────────────────
const ZONE_ORDER = ['Огород', 'У забора', 'Сарай', 'Теплица']
const ZONE_LAYOUT = {
  'Огород':   { left: 6.2,  top: 4.5,  width: 38.5, height: 41.9 },
  'У забора': { left: 51.8, top: 4.5,  width: 45.0, height: 41.9 },
  'Сарай':    { left: 3.2,  top: 54.2, width: 42.7, height: 41.3 },
  'Теплица':  { left: 51.8, top: 54.2, width: 45.0, height: 41.3 },
}
const MOVEMENT_PRESETS  = [{label:'медленно',value:60},{label:'средне',value:30},{label:'быстро',value:15}]
const FRESHNESS_PRESETS = [{label:'быстро',value:60},{label:'средне',value:180},{label:'медленно',value:360}]
const WORKLOG = [
  {status:'done', title:'Анализ задания и архитектурные решения'},
  {status:'done', title:'Модель расчёта (src/model.js)'},
  {status:'done', title:'Юнит-тесты (vitest, 22 кейса)'},
  {status:'done', title:'UI: тема Stardew Valley, иллюстрированная карта, попапы'},
  {status:'todo', title:'FastAPI бэкенд + интеграция Anthropic API'},
  {status:'todo', title:'Docker + docker-compose'},
  {status:'todo', title:'README и итоговая документация'},
]

const GARDEN_CROP_CYCLE = [
  'assets/crop-leafy.png','assets/crop-potted.png','assets/sv-cauliflower.png',
  'assets/crop-leafy.png','assets/sv-strawberry.png','assets/crop-potted.png',
  'assets/sv-pumpkin.png','assets/crop-leafy.png','assets/crop-potted.png',
]
const gardenPlants = (() => {
  const plants = []
  const gCols = 8, gRows = 6
  for (let r = 0; r < gRows - 1; r++) {
    for (let c = 0; c < gCols; c++) {
      const idx = r * gCols + c
      const src = GARDEN_CROP_CYCLE[idx % GARDEN_CROP_CYCLE.length]
      const big = src.includes('cauliflower') || src.includes('strawberry') || src.includes('pumpkin')
      const jitter = ((idx * 53) % 7) - 3
      plants.push({ src, left: 4 + c * (82 / (gCols - 1)) + jitter * 0.3, bottom: 4 + r * (90 / (gRows - 1)), width: big ? 9 : 6.5 })
    }
  }
  return plants
})()

// ── helpers ────────────────────────────────────────────────────────────────
function signalRole(pct) {
  if (pct >= 35) return { text: 'главный сигнал', color: '#c84b0f' }
  if (pct >= 15) return { text: 'заметный вклад', color: '#5c3319' }
  if (pct >= 5)  return { text: 'влияет слабо',   color: '#7a5235' }
  if (pct > 0)   return { text: 'почти не влияет', color: '#7a5235' }
  return { text: 'дубль', color: '#a08060' }
}

function buildSignalNote(pct, rel, isCollapsed) {
  const relNote = rel >= 0.7 ? 'доверие высокое' : rel >= 0.5 ? 'доверие среднее' : 'ненадёжный признак'
  if (isCollapsed) return 'уже учтён более сильный сигнал поблизости'
  if (pct >= 35) return `на нём держится бо́льшая часть оценки — ${relNote}`
  if (pct >= 15) return `заметный вклад в итоговую цифру — ${relNote}`
  if (pct >= 5)  return `влияет слабо — ${relNote}`
  return `${relNote}, почти не меняет итог`
}

function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (!events.length) return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  const recs = []
  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) recs.push(`Зона «${topZone[0]}» — самая активная (~${topZone[1].toFixed(1)} кр.). Начните следующий обход отсюда.`)
  if (events.some(e => e.event === 'motion_sensor')) recs.push('Датчик движения сработал — осмотрите сарай, пока следы свежие.')
  if (rabbits > 5) recs.push(`Оценка крупная (~${Math.round(rabbits)} кр.). Установите датчики в зонах без сигналов.`)
  if (confidence < 50) recs.push('Уверенность низкая. Добавьте сигналы из разных зон и разных типов.')
  const fp = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fp.length > 1) recs.push(`Следы в нескольких зонах (${fp.join(', ')}) — проверьте переходы между участками.`)
  if ((byZone['Теплица'] ?? 0) > 1) recs.push('Теплица: повышенная активность. Осмотрите периметр.')
  return recs.slice(0, 4)
}

function heatColor(value, max) {
  if (max < 0.001) return { color: 'hsl(120,28%,30%)', t: 0 }
  const t = Math.min(value / max, 1)
  const h = Math.round(118 - 98 * t), s = Math.round(28 + 57 * t), l = Math.round(30 + 14 * t)
  return { color: `hsl(${h},${s}%,${l}%)`, t }
}

function BLANK_EVENT() { return { event: 'footprints', location: 'Огород', count: 1, intensity: 5, time: '12:00' } }

// ── Custom dropdown (replaces native <select> so options are themeable) ──────
function renderSelect(id, options, currentValue, onchangeExpr) {
  const cur = options.find(o => o.value === currentValue)
  const optHTML = options.map(o => {
    const sv = o.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const call = onchangeExpr ? onchangeExpr.replace(/VALUE/g, "'" + sv + "'") + ';' : ''
    return `<div class="bf-csel-opt${o.value === currentValue ? ' sel' : ''}" onclick="${call}window._BFcsel.pick(this,'${id}','${sv}');event.stopPropagation();">${o.label}</div>`
  }).join('')
  const safeVal = (currentValue || '').replace(/"/g, '&quot;')
  return `<input type="hidden" id="${id}" value="${safeVal}"><div class="bf-csel" onclick="event.stopPropagation();window._BFcsel.toggle(this);"><div class="bf-csel-trigger"><span>${cur ? cur.label : currentValue}</span><span class="bf-csel-arrow">▾</span></div><div class="bf-csel-panel">${optHTML}</div></div>`
}

// ── state ──────────────────────────────────────────────────────────────────
let state = {
  events: [...INITIAL_EVENTS],
  params: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
  activeZone: null,
  activeTab: 'map',
  diaryOpen: false,
  scoreOpen: false,
  editingId: null,
  editDrafts: {},
  isAddingNew: false,
  newDraft: null,
  explainerOpen: false,
  llmRecs: null,
  llmLoading: false,
  customButtons: [],
  nextCqbId: 1,
  showCqbForm: false,
  customEventTypes: [],
  nextCetId: 1,
  showCetForm: false,
  importError: null,
  pdfLoading: false,
}

function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  render()
}

// ── global handlers ────────────────────────────────────────────────────────
window._BF = {
  setTab(id) { setState({ activeTab: id, activeZone: null }) },
  handleZoneClick(zone) { setState(s => ({ activeZone: s.activeZone === zone ? null : zone })) },
  closeZonePopup() { setState({ activeZone: null }) },
  openDiary() { setState({ diaryOpen: true }) },
  closeDiary() { setState({ diaryOpen: false, editingId: null, isAddingNew: false }) },
  openDiaryAdd() {
    const draft = BLANK_EVENT()
    if (state.activeZone) draft.location = state.activeZone
    setState({ diaryOpen: true, activeZone: null, isAddingNew: true, newDraft: draft })
  },
  openScorePopup() { setState({ scoreOpen: true }) },
  closeScorePopup() { setState({ scoreOpen: false }) },
  toggleExplainer() { setState(s => ({ explainerOpen: !s.explainerOpen })) },
  startEdit(id) {
    const evt = state.events.find(e => e.id === id)
    setState(s => ({ editingId: s.editingId === id ? null : id, editDrafts: { ...s.editDrafts, [id]: { ...evt } } }))
  },
  updateDraftField(id, field, value) {
    setState(s => ({ editDrafts: { ...s.editDrafts, [id]: { ...s.editDrafts[id], [field]: value } } }))
  },
  updateDraftCount(id, value) {
    setState(s => ({ editDrafts: { ...s.editDrafts, [id]: { ...s.editDrafts[id], count: Math.max(1, +value || 1) } } }))
  },
  updateDraftIntensity(id, value) {
    setState(s => ({ editDrafts: { ...s.editDrafts, [id]: { ...s.editDrafts[id], intensity: +value } } }))
  },
  saveEdit(id) {
    const draft = state.editDrafts[id]
    setState(s => ({ events: s.events.map(e => e.id === id ? { ...e, ...draft } : e), editingId: null }))
  },
  cancelEdit() { setState({ editingId: null }) },
  deleteEvent(id) { setState(s => ({ events: s.events.filter(e => e.id !== id), editingId: null })) },
  startAddEvent() { setState({ isAddingNew: true, newDraft: BLANK_EVENT() }) },
  cancelNewEvent() { setState({ isAddingNew: false, newDraft: null }) },
  updateNewDraft(field, value) { setState(s => ({ newDraft: { ...s.newDraft, [field]: value } })) },
  updateNewCount(value) { setState(s => ({ newDraft: { ...s.newDraft, count: Math.max(1, +value || 1) } })) },
  updateNewIntensity(value) { setState(s => ({ newDraft: { ...s.newDraft, intensity: +value } })) },
  saveNewEvent() {
    const d = state.newDraft
    setState(s => ({ events: [...s.events, { ...d, id: 'evt_' + Date.now() }], isAddingNew: false, newDraft: null }))
  },
  addCustomButton(data) {
    setState(s => ({
      customButtons: [...s.customButtons, { ...data, id: 'cqb_' + s.nextCqbId }],
      nextCqbId: s.nextCqbId + 1,
      showCqbForm: false,
    }))
  },
  deleteCustomButton(id) { setState(s => ({ customButtons: s.customButtons.filter(b => b.id !== id) })) },
  fireCustomButton(id) {
    const b = state.customButtons.find(x => x.id === id)
    if (!b) return
    const now = new Date().toTimeString().slice(0, 5)
    setState(s => ({
      events: [...s.events, {
        id: 'evt_' + Date.now(),
        event: b.event,
        location: b.location,
        count: b.count,
        intensity: b.intensity,
        time: now,
      }],
      activeTab: 'map',
    }))
  },
  saveCustomButton() {
    const label    = document.getElementById('cqb-label')?.value.trim()
    const event    = document.getElementById('cqb-event')?.value
    const location = document.getElementById('cqb-location')?.value
    const count    = +document.getElementById('cqb-count')?.value || 1
    const intensity= +document.getElementById('cqb-int')?.value   || 5
    if (!label) return
    window._BF.addCustomButton({ label, event, location, count, intensity })
  },
  toggleCqbForm() { setState(s => ({ showCqbForm: !s.showCqbForm })) },
  updateMovement(value) { setState(s => ({ params: { ...s.params, movementWindowMinutes: +value } })) },
  updateFreshness(value) { setState(s => ({ params: { ...s.params, freshnessWindowMinutes: +value } })) },
  updateReliability(type, value) {
    setState(s => ({ params: { ...s.params, reliability: { ...s.params.reliability, [type]: +value / 10 } } }))
  },
  updateRPU(type, value) {
    setState(s => ({ params: { ...s.params, rabbitsPerUnit: { ...s.params.rabbitsPerUnit, [type]: 0.3 + (+value - 1) / 9 * 1.7 } } }))
  },

  // ── Custom event types ──────────────────────────────────────────────────
  toggleCetForm() { setState(s => ({ showCetForm: !s.showCetForm })) },
  addCustomType({ label, emoji, rpu, rel }) {
    const id = 'cet_' + state.nextCetId
    setState(s => ({
      customEventTypes: [...s.customEventTypes, { id, label, emoji, rabbitsPerUnit: rpu, reliability: rel }],
      nextCetId: s.nextCetId + 1,
      showCetForm: false,
      params: {
        ...s.params,
        rabbitsPerUnit: { ...s.params.rabbitsPerUnit, [id]: rpu },
        reliability:    { ...s.params.reliability,    [id]: rel },
      },
    }))
  },
  deleteCustomType(id) {
    setState(s => {
      const newRpu = { ...s.params.rabbitsPerUnit }
      const newRel = { ...s.params.reliability }
      delete newRpu[id]
      delete newRel[id]
      return {
        customEventTypes: s.customEventTypes.filter(t => t.id !== id),
        events: s.events.filter(e => e.event !== id),
        params: { ...s.params, rabbitsPerUnit: newRpu, reliability: newRel },
      }
    })
  },
  saveCustomType() {
    const label = document.getElementById('cet-label')?.value.trim()
    const emoji = document.getElementById('cet-emoji')?.value.trim() || '🐇'
    const rpuSlider = +document.getElementById('cet-rpu')?.value || 5
    const relSlider = +document.getElementById('cet-rel')?.value || 5
    if (!label) return
    const rpu = 0.3 + (rpuSlider - 1) / 9 * 1.7
    const rel = 0.3 + (relSlider - 1) / 9 * 0.6
    window._BF.addCustomType({ label, emoji: emoji || '🐇', rpu, rel })
  },

  // ── Import / Export / PDF ───────────────────────────────────────────────
  exportEvents() {
    const content = JSON.stringify(state.events, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'bunfarm-events.json'
    a.click()
    URL.revokeObjectURL(url)
  },
  importEvents() {
    document.getElementById('bf-import-file')?.click()
  },
  handleImportFile(input) {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!Array.isArray(data)) throw new Error('Ожидается массив событий')
        if (data.length === 0) throw new Error('Массив пуст — нечего загружать')
        for (let i = 0; i < data.length; i++) {
          const item = data[i], pfx = `Запись ${i + 1}: `
          if (typeof item.id !== 'string' || !item.id) throw new Error(pfx + 'поле id должно быть строкой')
          if (typeof item.event !== 'string' || !item.event) throw new Error(pfx + 'поле event должно быть строкой')
          if (typeof item.location !== 'string' || !item.location) throw new Error(pfx + 'поле location должно быть строкой')
          if (!Number.isInteger(item.count) || item.count < 1) throw new Error(pfx + 'count должен быть целым числом ≥ 1')
          if (typeof item.intensity !== 'number' || item.intensity < 1 || item.intensity > 10) throw new Error(pfx + 'intensity должен быть числом от 1 до 10')
          if (typeof item.time !== 'string' || !/^\d{2}:\d{2}$/.test(item.time)) throw new Error(pfx + 'time должен быть в формате ЧЧ:ММ')
        }
        input.value = ''
        setState({ events: data, importError: null })
      } catch (err) {
        input.value = ''
        setState({ importError: err.message })
      }
    }
    reader.onerror = () => { input.value = ''; setState({ importError: 'Не удалось прочитать файл' }) }
    reader.readAsText(file)
  },
  downloadPdf() {
    if (state.pdfLoading) return
    setState({ pdfLoading: true })
    const { events, params } = state
    const allEventMeta = { ...EVENT_META }
    state.customEventTypes.forEach(t => { allEventMeta[t.id] = { label: t.label, emoji: t.emoji } })
    const rabbits      = calculateRabbits(events, params)
    const byZone       = calculateByZone(events, params)
    const confidence   = calculateConfidence(events, params, EVENT_TYPES.length + state.customEventTypes.length)
    const contributions = calculateContributions(events, params)
    const explanation  = buildSubtitle(rabbits, byZone, events, params, allEventMeta)
    import('./pdfReport.js').then(({ downloadPdfReport }) =>
      downloadPdfReport({ events, rabbits, confidence, contributions, byZone, params, eventMeta: allEventMeta, llmRecs: state.llmRecs, explanation })
    ).catch(err => console.error('PDF error:', err))
      .finally(() => setState({ pdfLoading: false }))
  },
}

// ── Custom dropdown controller ─────────────────────────────────────────────
window._BFcsel = {
  toggle(el) {
    const isOpen = el.classList.contains('open')
    document.querySelectorAll('.bf-csel.open').forEach(e => e.classList.remove('open'))
    if (!isOpen) el.classList.add('open')
  },
  pick(optEl, id, value) {
    const hidden = document.getElementById(id)
    if (hidden) hidden.value = value
    optEl.closest('.bf-csel')?.classList.remove('open')
  },
}
document.addEventListener('click', () => {
  document.querySelectorAll('.bf-csel.open').forEach(e => e.classList.remove('open'))
})

// ── render ─────────────────────────────────────────────────────────────────
function render() {
  const { events, params, activeZone, activeTab, diaryOpen, scoreOpen, editingId, editDrafts, isAddingNew, newDraft, explainerOpen, customEventTypes, importError, pdfLoading } = state

  const allEventTypes = [...EVENT_TYPES, ...customEventTypes.map(t => t.id)]
  const allEventMeta  = { ...EVENT_META }
  customEventTypes.forEach(t => { allEventMeta[t.id] = { label: t.label, emoji: t.emoji } })

  const rabbits = calculateRabbits(events, params)
  const confidence = calculateConfidence(events, params, allEventTypes.length)
  const contributions = calculateContributions(events, params)
  const byZone = calculateByZone(events, params)
  const explanation = buildSubtitle(rabbits, byZone, events, params, EVENT_META)
  const confColor = confidence >= 70 ? '#4caf50' : confidence >= 40 ? '#e8a020' : '#c84b0f'
  const rabbitsDisplay = rabbitRange(rabbits)

  const tabsHTML = ['map','settings','worklog'].map((id, i) => {
    const labels = ['Карта', 'Настройка модели', 'AI Worklog']
    const active = activeTab === id
    const activeStyle = active
      ? 'color:#3a2415;background:#f0dcae;border:2px solid #e0a83c;box-shadow:0 -2px 0 #e0a83c inset;'
      : 'color:#f0dcae;background:rgba(0,0,0,.16);border:2px solid rgba(240,220,174,.35);'
    return `<div class="hdr-tab" onclick="window._BF.setTab('${id}')" style="${activeStyle}">${labels[i]}</div>`
  }).join('')

  const evtCount = {}, lastTime = {}
  for (const e of events) {
    evtCount[e.location] = (evtCount[e.location] ?? 0) + 1
    if (!lastTime[e.location] || e.time > lastTime[e.location]) lastTime[e.location] = e.time
  }
  const maxEst = Math.max(...Object.values(byZone), 0.001)

  function renderMap() {
    const zonesHTML = ZONE_ORDER.map(id => {
      const layout = ZONE_LAYOUT[id]
      const heat = heatColor(byZone[id] ?? 0, maxEst)
      const count = evtCount[id] ?? 0
      const paws = Array.from({ length: Math.min(count, 5) }, (_, i) => ({
        left: 12 + (i * 16) % 70, top: 62 + ((i * 23) % 22), rot: (i * 37) % 60 - 30
      }))
      const glowSize = 65 + heat.t * 20
      const glowGrad = `radial-gradient(circle,hsla(${Math.round(40-20*heat.t)},90%,65%,${(0.12+heat.t*0.45).toFixed(2)}),transparent 70%)`

      const fr5 = `<img class="pix" src="assets/sv-fence-run.png" style="height:100%;width:20%;object-fit:cover;object-position:bottom left;margin-right:-2px;" />`.repeat(4)
        + `<img class="pix" src="assets/sv-fence-run.png" style="height:100%;width:20%;object-fit:cover;object-position:bottom left;" />`

      let decor = ''
      if (id === 'Сарай') {
        decor = `<div style="position:absolute;left:36%;top:76%;width:22%;height:16%;background:#8a5a34;border-radius:3px;pointer-events:none;"></div>
          <img class="pix" src="assets/sv-cabin.png" style="position:absolute;left:36%;top:0%;width:48%;transform:translate(-50%,0);filter:drop-shadow(3px 5px 3px rgba(0,0,0,.4));pointer-events:none;" />
          <img class="pix" src="assets/sv-coop.png" style="position:absolute;right:4%;top:30%;width:32%;filter:drop-shadow(3px 4px 3px rgba(0,0,0,.4));pointer-events:none;" />`
      } else if (id === 'Теплица') {
        decor = `<img class="pix" src="assets/sv-greenhouse.png" style="position:absolute;left:50%;top:6%;width:58%;height:78%;object-fit:contain;transform:translateX(-50%);filter:drop-shadow(3px 5px 3px rgba(0,0,0,.35));pointer-events:none;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;right:-8%;top:-2%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;right:-8%;top:18%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;right:-8%;top:38%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;right:-8%;top:58%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;right:-8%;top:78%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;right:-8%;top:98%;width:18%;pointer-events:none;z-index:2;" />`
      } else if (id === 'Огород') {
        const plantsHTML = gardenPlants.map(gp =>
          `<img class="pix" src="${gp.src}" style="position:absolute;left:${gp.left.toFixed(1)}%;bottom:${gp.bottom.toFixed(1)}%;width:${gp.width}%;pointer-events:none;" />`
        ).join('')
        decor = `<div style="position:absolute;left:-10%;top:20%;width:113%;height:14%;pointer-events:none;display:flex;align-items:flex-end;z-index:2;">${fr5}</div>
          <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-6%;top:-16%;width:17%;pointer-events:none;z-index:1;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:5%;top:-18%;width:15%;pointer-events:none;z-index:1;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:16%;top:-15%;width:13%;pointer-events:none;z-index:1;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-fence-post.png" style="position:absolute;left:0.5%;top:32%;height:16%;pointer-events:none;z-index:1;" />
          <img class="pix" src="assets/sv-fence-post.png" style="position:absolute;right:0.5%;top:32%;height:16%;pointer-events:none;z-index:1;" />
          <img class="pix" src="assets/sv-fence-post.png" style="position:absolute;left:0.5%;top:74%;height:16%;pointer-events:none;z-index:1;" />
          <img class="pix" src="assets/sv-fence-post.png" style="position:absolute;right:0.5%;top:74%;height:16%;pointer-events:none;z-index:1;" />
          <div style="position:absolute;left:8%;top:36%;width:84%;height:58%;background:#6b4423;border-radius:6px;box-shadow:inset 0 0 0 3px #4a2c14;background-image:repeating-linear-gradient(180deg,rgba(0,0,0,.08) 0px,rgba(0,0,0,.08) 3px,transparent 3px,transparent 11px);pointer-events:none;">${plantsHTML}</div>`
      } else if (id === 'У забора') {
        decor = `<div style="position:absolute;left:0.2%;top:20%;width:108%;height:14%;pointer-events:none;display:flex;align-items:flex-end;z-index:1;">${fr5}</div>
          <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;right:-10%;top:-18%;width:16%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:2%;top:-19%;width:14%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;right:11%;top:-16%;width:13%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:19%;top:-19%;width:14%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;right:5%;top:-8%;width:12%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:16%;top:-7%;width:12%;pointer-events:none;z-index:0;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;left:6%;top:31%;width:14%;pointer-events:none;z-index:3;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;left:20%;top:32%;width:14%;pointer-events:none;z-index:3;" />
          <img class="pix" src="assets/sv-well.png" style="position:absolute;left:40%;top:32%;width:18%;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));pointer-events:none;z-index:3;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;left:62%;top:32%;width:14%;pointer-events:none;z-index:3;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;left:76%;top:33%;width:14%;pointer-events:none;z-index:3;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;right:-8%;top:28%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-b.png" style="position:absolute;right:-8%;top:48%;width:18%;pointer-events:none;z-index:2;" />
          <img class="pix" src="assets/sv-bush-a.png" style="position:absolute;right:-8%;top:68%;width:18%;pointer-events:none;z-index:2;" />`
      }

      const ZONE_EMOJI = { 'Огород':'🥕','У забора':'🕳️','Сарай':'📡','Теплица':'🐾' }
      const isActive = activeZone === id
      const pawsHTML = paws.map(p =>
        `<span style="position:absolute;left:${p.left}%;top:${p.top}%;font-size:13px;opacity:.85;transform:rotate(${p.rot}deg);pointer-events:none;filter:drop-shadow(0 1px 0 rgba(0,0,0,.4));">🐾</span>`
      ).join('')

      return `<div onclick="window._BF.handleZoneClick('${id}')" style="position:absolute;left:${layout.left}%;top:${layout.top}%;width:${layout.width}%;height:${layout.height}%;border-radius:8px;cursor:pointer;border:2px solid transparent;background:transparent;overflow:visible;z-index:6;">
        <div style="position:absolute;left:20%;top:15%;width:${glowSize}%;height:${glowSize}%;border-radius:50%;background:${glowGrad};filter:blur(3px);mix-blend-mode:screen;pointer-events:none;"></div>
        ${decor}${pawsHTML}
        <div style="position:absolute;left:8px;top:6px;background:#3a2415;color:#f0dcae;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;border:1px solid #e0a83c;white-space:nowrap;z-index:3;">${id}</div>
        ${isActive?`<div style="position:absolute;inset:-3px;border-radius:10px;border:2px solid rgba(245,230,200,.7);pointer-events:none;"></div>`:''}
      </div>`
    }).join('')

    let popupHTML = ''
    if (activeZone) {
      const zoneEvents = events.filter(e => e.location === activeZone)
      const pctMap = Object.fromEntries(contributions.map(c => [c.id, c.percent]))
      const layout = ZONE_LAYOUT[activeZone]
      const zoneHeat = heatColor(byZone[activeZone] ?? 0, maxEst)
      const ZONE_EMOJI = { 'Огород':'🥕','У забора':'🕳️','Сарай':'📡','Теплица':'🐾' }
      const count = zoneEvents.length
      const activityText = count===0?'нет данных':zoneHeat.t>=0.66?'активность высокая':zoneHeat.t>=0.33?'активность средняя':'активность низкая'
      const popupLeft = layout.left < 30 ? 53 : 4

      const evListHTML = zoneEvents.map(e => {
        const meta = allEventMeta[e.event] ?? { emoji: '?', label: e.event }, pct = pctMap[e.id]??0
        return `<div style="background:rgba(255,248,225,.55);border:1px solid #c9a35f;border-radius:4px;padding:8px 10px;display:flex;gap:8px;align-items:center;font-size:12.5px;color:#4a3520;">
          <span>${meta.emoji}</span><span style="flex:1;">${meta.label}</span>
          <span style="color:#7a5235;font-size:.82rem;">${e.time}</span>
          <span style="color:${pct>=20?'#c84b0f':'#7a5235'};font-size:.82rem;min-width:32px;text-align:right;">${pct>0?pct+'%':'—'}</span>
        </div>`
      }).join('')

      popupHTML = `<div style="position:absolute;left:${popupLeft}%;top:6%;width:42%;max-width:420px;background:#f0dcae;border:5px solid #7a4a2a;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.45);z-index:40;animation:popIn .15s ease-out;">
        <div style="background:linear-gradient(#3f5c3a,#2e4429);padding:10px 14px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="color:#f0dcae;font-weight:800;font-size:15px;white-space:nowrap;">${ZONE_EMOJI[activeZone]??'📍'} ${activeZone}</div>
          <div style="color:#e0a83c;font-weight:700;font-size:12px;white-space:nowrap;flex:1;">${activityText}</div>
          <div onclick="window._BF.closeZonePopup()" style="width:22px;height:22px;flex-shrink:0;background:#c94b3f;border:2px solid #6b241c;border-radius:5px;color:#fff;font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</div>
        </div>
        <div style="padding:14px 16px;color:#3a2415;font-size:13px;line-height:1.5;">
          <div style="display:flex;gap:10px;margin-bottom:10px;">
            <div style="flex:1;background:rgba(122,74,42,.12);border-radius:6px;padding:8px;"><div style="font-weight:800;font-size:18px;">${count}</div><div style="font-size:11px;opacity:.75;">сигналов</div></div>
            <div style="flex:1;background:rgba(122,74,42,.12);border-radius:6px;padding:8px;"><div style="font-weight:800;font-size:18px;">${lastTime[activeZone]??'—'}</div><div style="font-size:11px;opacity:.75;">последний след</div></div>
            <div style="flex:1;background:rgba(122,74,42,.12);border-radius:6px;padding:8px;"><div style="font-weight:800;font-size:18px;">${rabbitRange(byZone[activeZone]??0)} 🐰</div><div style="font-size:11px;opacity:.75;">в этой зоне</div></div>
          </div>
          ${count===0?'<div style="color:#7a5235;font-size:13px;padding:4px 0 8px;">Нет зарегистрированных сигналов</div>':''}
          ${count>0?`<div style="font-weight:700;margin-bottom:6px;">Последние следы</div><div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;">${evListHTML}</div>`:''}
          <div style="display:flex;gap:8px;margin-top:12px;">
            <div onclick="window._BF.openDiaryAdd()" style="background:linear-gradient(#a97a4a,#7a4a2a);border:2px solid #4a2c14;color:#f0dcae;font-weight:700;border-radius:5px;padding:6px 14px;font-size:12px;box-shadow:0 2px 0 #2b1c10;cursor:pointer;">Добавить наблюдение</div>
          </div>
        </div>
      </div>`
    }

    const terrain = `<div style="position:absolute;inset:0;background:linear-gradient(160deg,#6fae4a 0%,#5c9b3e 35%,#4f8a3c 65%,#3f7530 100%);"></div>
      <div style="position:absolute;inset:0;background-image:url('assets/sv-grass-a.png');background-repeat:repeat;background-size:34px 44px;background-position:6px 4px;opacity:.28;image-rendering:pixelated;"></div>
      <div style="position:absolute;inset:0;background-image:url('assets/sv-grass-b.png');background-repeat:repeat;background-size:29px 38px;background-position:20px 22px;opacity:.22;image-rendering:pixelated;"></div>
      <div style="position:absolute;left:0;top:46.6%;width:100%;height:7.4%;background-image:url('assets/sv-divider-swatch.png');background-repeat:repeat;background-size:30px 30px;image-rendering:pixelated;box-shadow:inset 0 0 10px rgba(0,0,0,.35),0 0 0 2px rgba(58,40,20,.5);z-index:1;"></div>
      <div style="position:absolute;left:45.5%;top:0;width:6.4%;height:100%;background-color:#8f877a;background-image:url('assets/sv-path-stone.png');background-repeat:repeat;background-size:34px 34px;image-rendering:pixelated;box-shadow:inset 0 0 10px rgba(0,0,0,.35),2px 0 0 rgba(58,40,20,.55),-2px 0 0 rgba(58,40,20,.55);clip-path:polygon(18% 0%,82% 0%,100% 4%,88% 9%,100% 14%,84% 19%,96% 24%,80% 29%,100% 34%,86% 39%,98% 44%,82% 49%,100% 54%,84% 59%,96% 64%,80% 69%,100% 74%,86% 79%,98% 84%,82% 89%,100% 94%,82% 100%,18% 100%,0% 96%,16% 91%,2% 86%,20% 81%,4% 76%,18% 71%,0% 66%,16% 61%,2% 56%,20% 51%,0% 46%,18% 41%,4% 36%,16% 31%,0% 26%,20% 21%,2% 16%,18% 11%,0% 6%);z-index:2;"></div>
      <img class="pix" src="assets/sv-pebble-b.png" style="position:absolute;left:9%;top:47.5%;width:1.9%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-d.png" style="position:absolute;left:29%;top:48.4%;width:2%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-a.png" style="position:absolute;left:52%;top:47.3%;width:1.8%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-c.png" style="position:absolute;left:80%;top:48.4%;width:2%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-d.png" style="position:absolute;left:93%;top:47.4%;width:1.9%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-a.png" style="position:absolute;left:47.5%;top:6%;width:2.4%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-b.png" style="position:absolute;left:47.9%;top:16%;width:2.2%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-c.png" style="position:absolute;left:47.4%;top:28%;width:2.6%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-d.png" style="position:absolute;left:47.8%;top:38%;width:2.4%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-a.png" style="position:absolute;left:47.4%;top:63%;width:2.4%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-b.png" style="position:absolute;left:47.9%;top:73%;width:2.2%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-c.png" style="position:absolute;left:47.5%;top:88%;width:2.4%;pointer-events:none;z-index:2;" />
      <img class="pix" src="assets/sv-pebble-c.png" style="position:absolute;left:8%;top:47.6%;width:2%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-a.png" style="position:absolute;left:22%;top:48.2%;width:1.8%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-d.png" style="position:absolute;left:35%;top:47.4%;width:2%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-b.png" style="position:absolute;left:60%;top:48%;width:1.9%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-c.png" style="position:absolute;left:73%;top:47.5%;width:2.1%;pointer-events:none;z-index:1;" />
      <img class="pix" src="assets/sv-pebble-a.png" style="position:absolute;left:87%;top:48.3%;width:1.8%;pointer-events:none;z-index:1;" />`

    const borderTrees = `<img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-6%;top:-10%;width:9%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-8%;top:-4%;width:9%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-9%;top:6%;width:8%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-6.5%;top:13%;width:8.5%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-3.5%;top:23%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-3%;top:44%;width:10%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-5%;top:60%;width:8%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-1.5%;top:67%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-3%;top:82%;width:12.5%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;right:-3%;top:-13%;width:9%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:11%;top:-12%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-1.5%;bottom:-11%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:-2%;bottom:-12%;width:13%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:8;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;right:9%;bottom:-5%;width:12%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:8;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;right:20%;bottom:-16%;width:13%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:8;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:36%;bottom:-19%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:2;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-9%;top:-12%;width:13%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:9;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-2%;top:-14%;width:12%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:9;" />
      <img class="pix" src="assets/sv-tree-a.png" style="position:absolute;left:-11%;top:-2%;width:11%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:9;" />
      <img class="pix" src="assets/sv-tree-b.png" style="position:absolute;left:-8%;top:8%;width:12%;pointer-events:none;filter:drop-shadow(2px 3px 2px rgba(0,0,0,.35));z-index:9;" />`

    return `<div style="position:relative;width:100%;aspect-ratio:440/300;border-radius:10px;overflow:hidden;border:6px solid #6a4326;box-shadow:0 6px 0 rgba(0,0,0,.35),inset 0 0 0 2px #4a2c14;">
      ${terrain}${zonesHTML}
      <div style="position:absolute;left:0;bottom:4px;width:100%;text-align:center;font-size:.78rem;color:#f5ffe0;text-shadow:0 1px 3px rgba(0,0,0,.7);z-index:50;">нажмите на зону для подробностей</div>
      ${borderTrees}${popupHTML}
    </div>`
  }

  function tip(text) {
    const escaped = text.replace(/'/g, '&#39;').replace(/"/g, '&quot;')
    return `<span style="position:relative;display:inline-block;">
      <button type="button"
        style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#8b5e3c;border:none;color:#f5e6c8;font-size:11px;font-weight:bold;cursor:pointer;vertical-align:middle;margin-left:5px;flex-shrink:0;line-height:1;"
        onmouseenter="this.nextElementSibling.style.display='block'"
        onmouseleave="this.nextElementSibling.style.display='none'"
        onfocus="this.nextElementSibling.style.display='block'"
        onblur="this.nextElementSibling.style.display='none'"
        aria-label="Подсказка">?</button>
      <span style="display:none;position:absolute;left:0;top:calc(100% + 5px);z-index:200;width:230px;background:#3a2415;color:#f5e6c8;font-size:.8rem;padding:7px 10px;border:2px solid #8b5e3c;border-radius:4px;line-height:1.4;box-shadow:3px 3px 0 rgba(0,0,0,.5);pointer-events:none;">${text}</span>
    </span>`
  }

  function renderSettings() {
    const { customButtons, showCqbForm, showCetForm } = state
    const mvHTML = MOVEMENT_PRESETS.map(p => {
      const active = params.movementWindowMinutes === p.value
      return `<div onclick="window._BF.updateMovement(${p.value})" style="flex:1;text-align:center;padding:5px 8px;background:${active?'#e8a020':'rgba(92,51,25,.1)'};border:2px solid #8b5e3c;border-radius:4px;color:${active?'#3d1f00':'#7a5235'};font-size:.95rem;cursor:pointer;">${p.label}</div>`
    }).join('')
    const frHTML = FRESHNESS_PRESETS.map(p => {
      const active = params.freshnessWindowMinutes === p.value
      return `<div onclick="window._BF.updateFreshness(${p.value})" style="flex:1;text-align:center;padding:5px 8px;background:${active?'#e8a020':'rgba(92,51,25,.1)'};border:2px solid #8b5e3c;border-radius:4px;color:${active?'#3d1f00':'#7a5235'};font-size:.95rem;cursor:pointer;">${p.label}</div>`
    }).join('')
    const blocksHTML = allEventTypes.map(type => {
      const meta = allEventMeta[type]
      const isCustom = customEventTypes.some(t => t.id === type)
      const relSlider = Math.round(params.reliability[type] * 10)
      const rpuSlider = Math.max(1, Math.min(10, Math.round((params.rabbitsPerUnit[type] - 0.3) / 1.7 * 9 + 1)))
      return `<div style="border-bottom:1px dashed rgba(139,94,60,.3);padding-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:1rem;color:#5c3319;margin-bottom:5px;">
          <span>${meta.emoji} ${meta.label}</span>
          ${isCustom ? `<span onclick="window._BF.deleteCustomType('${type}')" title="Удалить тип" style="margin-left:auto;background:none;border:none;color:#c84b0f;cursor:pointer;font-size:.8rem;padding:0 4px;" >✕ удалить</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;margin-bottom:3px;">
          <span style="font-size:.85rem;color:#7a5235;">Доверие к сигналу</span>
          ${tip('Насколько надёжен этот тип следа. При высоком доверии система берёт сигнал в полную силу.')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <input type="range" min="1" max="10" step="1" value="${relSlider}" oninput="document.getElementById('rel_${type}').textContent=this.value" onchange="window._BF.updateReliability('${type}',this.value)" style="flex:1;" />
          <span id="rel_${type}" style="min-width:20px;text-align:right;color:#5c3319;font-weight:bold;">${relSlider}</span>
        </div>
        <div style="display:flex;align-items:center;margin-bottom:3px;">
          <span style="font-size:.85rem;color:#7a5235;">Кроликов за сигнал</span>
          ${tip('Множитель, а не прямое число. Итог меньше: доверие, заметность и схлопывание дублей уменьшают вклад.')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="range" min="1" max="10" step="1" value="${rpuSlider}" oninput="document.getElementById('rpu_${type}').textContent=this.value" onchange="window._BF.updateRPU('${type}',this.value)" style="flex:1;" />
          <span id="rpu_${type}" style="min-width:20px;text-align:right;color:#5c3319;font-weight:bold;">${rpuSlider}</span>
        </div>
      </div>`
    }).join('')

    const cqbListHTML = customButtons.length
      ? customButtons.map(b => `
          <span style="display:inline-flex;align-items:center;gap:5px;background:#d4b896;border:2px solid #8b5e3c;padding:4px 10px;border-radius:4px;font-size:.9rem;color:#3d1f00;">
            <span onclick="window._BF.fireCustomButton('${b.id}')" style="cursor:pointer;">${allEventMeta[b.event]?.emoji||'?'} ${b.label}</span>
            <button onclick="window._BF.deleteCustomButton('${b.id}')" style="background:none;border:none;color:#7a2000;cursor:pointer;font-size:.8rem;padding:0 2px;" title="Удалить">✕</button>
          </span>`).join('')
      : `<span style="font-size:.85rem;color:#7a5235;">Пока нет кнопок — добавьте ниже</span>`

    const cqbFormHTML = showCqbForm ? `
      <div style="margin-top:8px;background:rgba(0,0,0,.05);border:1px solid #c4a06c;border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Название
            <input id="cqb-label" type="text" placeholder="напр. Следы в сарае" maxlength="30" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Тип сигнала
            ${renderSelect('cqb-event', allEventTypes.map(t => ({value: t, label: allEventMeta[t].emoji + ' ' + allEventMeta[t].label})), allEventTypes[0] || EVENT_TYPES[0], '')}
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Зона
            ${renderSelect('cqb-location', LOCATIONS.map(l => ({value: l, label: l})), LOCATIONS[0], '')}
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Кол-во
            <input id="cqb-count" type="number" value="1" min="1" max="99" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Сила (1-10)
          <input id="cqb-int" type="number" value="5" min="1" max="10" style="width:80px;padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
        </label>
        <div style="display:flex;gap:8px;">
          <div onclick="window._BF.saveCustomButton()" style="background:#e8a020;border:2px solid #8b5e3c;color:#3d1f00;padding:4px 14px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:.9rem;">✓ Добавить кнопку</div>
          <div onclick="window._BF.toggleCqbForm()" style="border:1px solid #8b5e3c;color:#7a5235;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.9rem;">Отмена</div>
        </div>
      </div>` : `<div onclick="window._BF.toggleCqbForm()" style="margin-top:8px;display:inline-block;background:rgba(92,51,25,.1);border:2px solid #8b5e3c;color:#5c3319;padding:3px 12px;border-radius:4px;cursor:pointer;font-size:.9rem;">+ Новая кнопка</div>`

    const cetFormHTML = showCetForm ? `
      <div style="margin-top:8px;background:rgba(0,0,0,.05);border:1px solid #c4a06c;border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Название
            <input id="cet-label" type="text" placeholder="напр. Укус" maxlength="30" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Эмодзи
            <input id="cet-emoji" type="text" placeholder="🐰" maxlength="4" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:.85rem;color:#7a5235;">Доверие к сигналу (1–10)
          ${tip('Насколько надёжен этот тип наблюдения. Высокое доверие — сигнал учитывается в полную силу.')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="cet-rel" type="range" min="1" max="10" step="1" value="5" oninput="document.getElementById('cet-rel-v').textContent=this.value" style="flex:1;" />
          <span id="cet-rel-v" style="min-width:20px;text-align:right;color:#5c3319;font-weight:bold;">5</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:.85rem;color:#7a5235;">Кроликов за сигнал (1–10)
          ${tip('Сколько кроликов "весит" один такой след. Высокое значение — сигнал сильно влияет на итог.')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="cet-rpu" type="range" min="1" max="10" step="1" value="5" oninput="document.getElementById('cet-rpu-v').textContent=this.value" style="flex:1;" />
          <span id="cet-rpu-v" style="min-width:20px;text-align:right;color:#5c3319;font-weight:bold;">5</span>
        </div>
        <div style="display:flex;gap:8px;">
          <div onclick="window._BF.saveCustomType()" style="background:#e8a020;border:2px solid #8b5e3c;color:#3d1f00;padding:4px 14px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:.9rem;">✓ Создать тип</div>
          <div onclick="window._BF.toggleCetForm()" style="border:1px solid #8b5e3c;color:#7a5235;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.9rem;">Отмена</div>
        </div>
      </div>` : `<div onclick="window._BF.toggleCetForm()" style="margin-top:8px;display:inline-block;background:rgba(92,51,25,.1);border:2px solid #8b5e3c;color:#5c3319;padding:3px 12px;border-radius:4px;cursor:pointer;font-size:.9rem;">+ Добавить тип сигнала</div>`

    return `<div style="display:flex;flex-direction:column;gap:12px;">
      <div style="border-bottom:1px dashed rgba(139,94,60,.3);padding-bottom:12px;">
        <div style="display:flex;align-items:center;font-size:1rem;color:#5c3319;margin-bottom:8px;">
          🚀 Быстрые кнопки
          ${tip('Создайте кнопки для частых комбинаций. Нажатие добавляет событие с текущим временем и открывает карту.')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${cqbListHTML}</div>
        ${cqbFormHTML}
      </div>
      <div style="border-bottom:1px dashed rgba(139,94,60,.3);padding-bottom:10px;">
        <div style="display:flex;align-items:center;font-size:1rem;color:#5c3319;margin-bottom:6px;">
          🏃 Скорость перемещения
          ${tip('Если два следа в разных местах появились близко по времени — возможно, один кролик. Чем быстрее — тем строже объединяем события.')}
        </div>
        <div style="display:flex;gap:6px;">${mvHTML}</div>
      </div>
      <div style="border-bottom:1px dashed rgba(139,94,60,.3);padding-bottom:10px;">
        <div style="display:flex;align-items:center;font-size:1rem;color:#5c3319;margin-bottom:6px;">
          ⏱️ Как быстро выцветают следы
          ${tip('Свежие следы значат больше старых. Быстро — старые почти не учитываются; медленно — вес падает не так резко.')}
        </div>
        <div style="display:flex;gap:6px;">${frHTML}</div>
      </div>
      ${blocksHTML}
      <div style="border-top:2px dashed rgba(139,94,60,.3);padding-top:14px;">
        <div style="display:flex;align-items:center;font-size:1rem;color:#5c3319;margin-bottom:8px;">
          🔬 Кастомные типы сигналов
          ${tip('Добавьте свои типы наблюдений с произвольным именем, эмодзи и весами. Они появятся в журнале и в форме быстрых кнопок.')}
        </div>
        ${cetFormHTML}
      </div>
    </div>`
  }

  function renderWorklog() {
    const p  = (t)  => `<p style="font-size:.88rem;color:#3d1f00;margin:0 0 8px;line-height:1.6;">${t}</p>`
    const h2 = (t)  => `<div style="font-size:1.05rem;font-weight:700;color:#3d1f00;margin:20px 0 6px;border-bottom:2px solid #8b5e3c;padding-bottom:4px;">${t}</div>`
    const h3 = (t)  => `<div style="font-size:.98rem;font-weight:700;color:#5c3319;margin:14px 0 5px;">${t}</div>`
    const b  = (t)  => `<strong style="font-weight:700;color:#5c3319;">${t}</strong>`
    const li = (t)  => `<li style="font-size:.88rem;color:#3d1f00;padding:2px 0 2px 14px;position:relative;line-height:1.55;"><span style="position:absolute;left:0;color:#8b5e3c;">·</span>${t}</li>`
    const ul = (items) => `<ul style="list-style:none;margin:0 0 8px;padding:0;">${items.map(li).join('')}</ul>`
    const note = (t) => `<div style="font-size:.85rem;color:#7a5235;font-style:italic;border-left:3px solid rgba(139,94,60,.4);padding:6px 10px;margin:8px 0;background:rgba(92,51,25,.06);line-height:1.55;">${t}</div>`

    return `<div style="display:flex;flex-direction:column;gap:0;line-height:1.55;color:#3d1f00;">
      ${p('Всем привет! Постаралась описать кратко, как разрабатывала этот проект. Тестовое сделано с помощью Claude, никакие другие ЛЛМ не использовала. По всем вопросам могу ответить дополнительно, если они будут. Приятного чтения :)')}

      ${h3('1. Первая задача для AI')}
      ${p(`Я решила выбрать сценарий "Ферма невидимых кроликов", потому что мне показалось, что есть где разгуляться, чтобы показать архитектурное мышление (инференсы). Начала с разбора ТЗ: что вообще требуется и как я буду это проектировать? ЛЛМ на рекомендации, интерфейс в игровой стилистике (задание напомнило мне игру Stardew Valley, так что решила поиграться с этим).<br>Формат: собственный сабдомен, деплой на свою инфраструктуру (Vultr + Caddy + GitHub Actions) - тот же паттерн, что и на личных проектах.<br>Сразу же отрисовала фавикон на сабдомен для красоты (готовый svg, переделанный клод дизайном) С этим пришла в Claude обсуждать ТЗ и мой черновой набросок. Клод подтвердил, что ТЗ ок, но назвал мое желание поднять бэкэнд оверинжинирингом, так что пришлось потратить какое-то количество токенов, чтобы объяснить свою идею. Параллельно подняла локалхост с предложения Клода (что оказалось огромной ошибкой и стоило мне часов времени, но об этом позже)`)}

      ${h3('2. Как просила помочь со структурой/архитектурой')}
      ${p(`Сначала мы с Клодом на пару разбирали работу модели: как след превращается в оценку кроликов, как считается уверенность, какие веса чему присваиваем. Решила использовать тестовые данные из ТЗ как стартовые логи журнала. Процесс был не супер быстрым и мы ооочень долго утверждали, что и как будет считаться. Клод хотел упростить, потому что видел мало тестовых данных, а мне наоборот казалось, что можно развить это до вменяемой системы. Например, почему мы не учитываем время перемещения в оценке модели? Поэтому я добавила в оценку еще и схлопывание сигналов по времени для правдоподобия, Клод это принял и сразу же внес в структуру.`)}
      ${p(`Для проектирования я обычно использую Claude Opus на effort medium и выше, но в этот раз игралась с Fable. После обсуждения говорила ему написать промпт и с ним шла в Claude Code CLI. Для разработки использовала Claude Sonnet на effort medium/high.`)}
      ${p(`${b('Почему не оркестрация агентов:')} потому что хотела контролировать процесс и своевременно вносить правки. Мне в кайф, время не поджимало.<br>${b('Почему не пишу промпты сама:')} потому что Клод справляется с этим быстрее и точнее меня. Я немного хаотична и не экономлю на токенах в подписке, Клод закрывает этот гап.<br>Цикл разработки разбила на три фазы: сначала каркас, потом минимальный UI и тесты, потом интеграция ЛЛМ на рекомендации и Docker compose. Перед каждой фазой обсуждали с Клодом, что я хочу видеть в итоге, после каждой фазы проверка результата.`)}

      ${h3('3. Что решила сама, что изменила после ответа AI')}
      ${p(`${b('Что решила сама')} (помимо архитектуры, стилистики тестового и контроля разработки):`)}
      ${ul([
        'Настояла, что модель должна учитывать время не только в схлопывании, но и в расчёте уверенности. Клод об этом не подумал, но я подумала за него.',
        'Нашла логическую дыру в факторе "согласованность": он считал только пространственный разброс, игнорируя время. Заставила переписать: одновременные сигналы в разных зонах = точно разные кролики (уверенность выше), близкие по времени = может, один перемещается (уверенность ниже)',
        'ЛЛМ на рекомендации. Claude Haiku дешевый и более живой в таких задачах.',
        'Решила разделить "Журнал сигналов" (факты) и "Настройку модели" (веса). Клод сначала смешал их в одном месте, это показалось мне странным.',
        'Добавила кастомные типы сигналов и настояла, что вес задаётся и при создании, и потом в настройках. Клод не заложил это в архитектуру вообще, а потом предлагал дефолтные значения, что показалось мне несправедливым.',
        'Мелкие правки: округление кроликов до целых чисел, разброс элементов по экрану, кнопочки.',
      ])}
      ${p(`${b('Что изменила после ответа ИИ:')}`)  }
      ${ul([
        'Не закладывать скорость перемещения кроликов как константу, а сделать параметром. Сразу было одобрено.',
        'Не делать вебхук. Я сделала по приколу, потом оказалось, что фича сломана. Вместо починки послушала Клода и откатила.',
        'Закрыть эндпоинт к платному АПИ (все-таки мои деньги на вызовы хайку).',
        'Добавить в оценку модели свежесть сигнала (свежие весят больше, чем старые). Было реализовано.',
        'Переосмыслить дизайн: так появилась кнопка, открывающая дневник фермера (изначально я видела это как просто журнал логов слева, а карта и вкладки справа)',
      ])}

      ${h3('4. Доработка логики, UX/UI, поведения')}
      ${ul([
        'Убрала технический жаргон отовсюду (заметность, вклад, доверие к сигналу) - ловила на себе, что не сразу понимаю термин, значит и фермер не поймёт. Это очень критично в процессе разработки: конечным продуктом будет пользоваться обычный человек без технического образования, все должно быть интуитивно понятно.',
        'Развела шапку (JS, бесплатно, обновляется на каждое движение слайдера) и вкладку рекомендаций (LLM, дороже, с фоллбэком на правилах, если бэкенд недоступен). Продумала экономику вызовов, потому что прикинула, что настройки можно крутить бесконечно, а значит пихать в шапку ЛЛМ не кост-эффективно. Клод сказал, что решение резонно.',
        'Заставила добавить разбор оценки понятным языком вместо сырых чисел.',
        'Переработала весь интерфейс так, чтобы он был интуитивно понятным. Фермер не будет разбираться сто часов, как пользоваться интерфейсом, ему просто нужно знать, сколько кроликов на его ферме и почему.',
        'Сделала маленькие подсказочки на всякий случай, если фермеру что-то будет непонятно. Лучше, чем гайд на всю страницу с занудной лексикой.',
        'Несколько раз перепроверила логику модели, переписала вкладку с оценкой (на случай, если вдруг фермер захочет понять, как работает его интерфейс и откуда берется уверенность). Даже пересчитала вручную - я очень тревожная за работу кора в таких проектах, потому что никакой красивый интерфейс не имеет значения, если кор работает криво.',
        'Отрисовала дизайн в Клод дизайне - закинула ему ассетов из Стардью для вайба, потому что прототип от Клод кода был сносный, но сырой. Дизайн правила долго, хотелось аутентичности.',
      ])}

      ${h3('5. Какие ошибки нашла и как исправила')}
      ${ul([
        `${b('Разработка на локалхосте (идея Клода)')} При переносе на сервер и сабдомен не закоммитилась часть файлов. Потратила некоторое время на фикс, параллельно отчитывая Клода, что "я же говорила, что надо было сразу накатывать на прод". Гит чек и мерж. Локалхост был лишним для этого проекта, ошибка стоила мне нескольких часов жизни (и тысяч токенов с подписки).`,
        'Дропдаун оставался системным дважды, несмотря на отчёт "исправлено", фиксила и проверяла глазами каждый раз.',
        'Импорт JSON затирал журнал вместо добавления к нему. Делегировала фикс бага Клоду, просто сказав ему, что журнал должен оставаться на месте.',
        'PDF-отчёт дублировал сырой экспорт вместо настоящего отчёта. Проблема была в кириллице, так что решила имплементировать картинки из интерфейса вместо текста. Отчет читают глазами. Сознательно отказалась от полного фикса, потому что это тестовое задание, а не разработка за многоденяк для клиентов.',
        'Кастомный тип сигнала показывал технический id вместо названия в шапке. Быстрый фикс промптом в КЛИ.',
        'Чуть не забыла, что .env может быть закоммичен в публичном репозитории (при создании репо я не делала дефолтный гитигнор из-за стека). Проверила git-check-ignore перед публикацией, успокоилась.',
        'После деплоя на сервер сломалась интеграция с Claude, отдавался просто фоллбэк. Проблема была не в коде, а в инфраструктуре - у меня бардак в токенах на сервере. Искала проблему вручную, потом просто делегировала все Клод коду, который и подсказал мне, что я подтянула не тот токен.',
        'Клод код неправильно перенес мой дизайн проект из Клод дизайна, потратила много времени, чтобы накатить правильно (промптами и частично вручную правя код).',
        'Мелкие баги интерфейса (всплывающая подсказка, которая не ездила за курсором, расположение вкладок, шапка). Точечные баги, быстрый фикс в КЛИ.',
      ])}

      ${h3('6. Как проверяла финальный результат')}
      ${note('Я никогда не верю ни одному текстовому отчёту на слово. Claude очень любит откладывать на потом мелкие фиксы и/или игнорировать часть инструкций. Периодически я просто оркестрирую агентов, чтобы ЛЛМ автономно делала, но в этот раз у меня было свободное время.')}
      ${p('Так что я:')}
      ${ul([
        'заложила в архитектуру автотесты',
        'сверила стартовые данные 1:1 с JSON из ТЗ построчно',
        'посчитала вклад одного сигнала вручную по формуле, сверила с UI (писала об этом выше)',
        'проверила интеграцию с Claude напрямую через curl, а не по виду интерфейса',
        'прогнала деплой через реальный docker, когда что-то не сходилось, вместо того, чтобы гадать по описанию',
        'закинула тестовое в Клод и заставила его написать мне чек-лист того, что должно быть в итоге и что от меня требуется. Проходилась по каждому пункту и сверяла с реальным кодом и интерфейсом, фиксила мелочи, пока меня не устроило.',
      ])}

      ${h2('Спасибо за внимание :)')}
      ${p('Я бы очень хотела получить обратную связь по тестовому заданию! Даже если мы не сможем сотрудничать, я была бы рада каким-то подсказкам, как можно сделать лучше.')}
      ${p(`${b('— Карина Ларк')}`)}
    </div>`
  }

  function renderScorePopup() {
    const totalVal = contributions.reduce((s, c) => s + c.value, 0)
    const evtMap = Object.fromEntries(events.map(e => [e.id, e]))
    const ranked = [...contributions].sort((a, b) => b.value - a.value).map(c => {
      const evt = evtMap[c.id]; if (!evt) return null
      const meta = allEventMeta[evt.event] ?? { emoji: '?', label: evt.event }
      const isCollapsed = c.percent === 0
      const pct = isCollapsed ? 0 : Math.round((c.value / (totalVal || 1)) * 100)
      const role = signalRole(pct)
      const rel = params.reliability[evt.event] ?? 0.5
      return { emoji: meta.emoji, label: meta.label, location: evt.location, roleText: role.text, roleColor: role.color,
        pct, isCollapsed, note: buildSignalNote(pct, rel, isCollapsed), opacity: isCollapsed ? 0.5 : 1 }
    }).filter(Boolean)

    const signalsHTML = ranked.map(s => `<div style="padding:8px 0;border-bottom:1px dashed rgba(139,94,60,.2);opacity:${s.opacity};">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
        <span style="font-size:15px;">${s.emoji}</span>
        <span style="flex:1;">${s.label} <span style="color:#7a5235;font-size:12px;">(${s.location})</span></span>
        <span style="font-size:11px;padding:1px 9px;border-radius:10px;border:1px solid ${s.roleColor};color:${s.roleColor};white-space:nowrap;">${s.roleText}</span>
      </div>
      ${!s.isCollapsed?`<div style="display:flex;align-items:center;gap:8px;padding-left:28px;"><div style="width:90px;height:8px;background:rgba(139,94,60,.15);border:1px solid rgba(139,94,60,.2);border-radius:3px;overflow:hidden;flex-shrink:0;"><div style="height:100%;background:${s.roleColor};width:${s.pct}%;"></div></div><span style="font-size:11px;color:#7a5235;font-style:italic;">${s.note}</span></div>`:
      `<div style="padding-left:28px;font-size:11px;color:#7a5235;font-style:italic;">${s.note}</div>`}
    </div>`).join('')

    const factors = getConfidenceFactors(events, params)
    const uniqueTypes = new Set(events.map(e => e.event)).size
    const factorDefs = [
      { label:'Разнообразие сигналов', value:factors.diversity,
        con: p => p>=65?`${uniqueTypes} типа(ов) — хорошее разнообразие`:p>=35?`${uniqueTypes} типа(ов) — неплохо, но можно больше`:`всего ${uniqueTypes} тип(а) — мало разнообразия` },
      { label:'Сила следов', value:factors.avgIntensity,
        con: p => p>=65?'следы чёткие и выраженные':p>=35?'следы умеренной силы':'следы слабые — возможно, всё почудилось' },
      { label:'Согласованность по зонам', value:factors.consistency,
        con: p => p>=65?'видно, что кроликов несколько':p>=35?'нейтральная картина':'возможно, один кролик перебегает' },
    ]
    const factorsHTML = factorDefs.map(f => {
      const pct = Math.round(f.value*100), color = pct>=65?'#4caf50':pct>=35?'#e8a020':'#c84b0f'
      return `<div style="padding:6px 0;border-bottom:1px dashed rgba(139,94,60,.15);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span>${f.label}</span><span style="font-size:12px;color:${color};">${pct>=65?'высокий':pct>=35?'средний':'низкий'}</span>
        </div>
        <div style="height:9px;background:rgba(139,94,60,.2);border:1px solid rgba(139,94,60,.25);border-radius:3px;overflow:hidden;margin-bottom:4px;"><div style="height:100%;background:${color};width:${pct}%;"></div></div>
        <div style="font-size:11px;color:#7a5235;font-style:italic;line-height:1.3;">${f.con(pct)}</div>
      </div>`
    }).join('')

    const explContent = explainerOpen ? `<div style="padding:10px 16px 14px;background:rgba(245,230,200,.4);display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.5;">
      <div><strong style="color:#5c3319;">3 шага расчёта:</strong> 1) каждый след → кролики (сколько × курс × доверие × заметность × свежесть); 2) схлопываем дубли рядом по месту и времени; 3) складываем остаток с поправкой на перемещение между зонами.</div>
      <div style="background:rgba(139,94,60,.08);border-left:3px solid rgba(139,94,60,.4);padding:6px 10px;border-radius:0 4px 4px 0;"><strong style="color:#5c3319;">Уверенность — не оценка.</strong> Она показывает, насколько цифре можно верить: разнообразие сигналов, сила следов, согласованность по зонам.</div>
    </div>` : ''

    return `<div style="position:fixed;inset:0;background:rgba(20,14,8,.5);z-index:90;display:flex;align-items:flex-start;justify-content:flex-end;padding:90px 30px 30px;">
      <div style="width:min(760px,92vw);max-height:82vh;overflow-y:auto;background:#f0dcae;border:5px solid #7a4a2a;border-radius:10px;box-shadow:0 20px 45px rgba(0,0,0,.5);animation:popIn .15s ease-out;">
        <div style="background:linear-gradient(#3f5c3a,#2e4429);padding:12px 16px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;top:0;">
          <div style="color:#f0dcae;font-weight:800;font-size:16px;white-space:nowrap;">🔍 Разбор оценки — ≈ ${rabbitsDisplay} кроликов</div>
          <div onclick="window._BF.closeScorePopup()" style="width:24px;height:24px;flex-shrink:0;background:#c84b0f;border:2px solid #6b241c;border-radius:5px;color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</div>
        </div>
        <div style="padding:16px 18px 20px;color:#3a2415;font-size:13px;">
          <div style="border-bottom:1px solid rgba(139,94,60,.3);margin-bottom:12px;">
            <div onclick="window._BF.toggleExplainer()" style="padding:9px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px;color:#5c3319;cursor:pointer;background:rgba(92,51,25,.06);">
              <span>ℹ️ Как устроена оценка</span><span>${explainerOpen?'▲':'▼'}</span>
            </div>
            ${explContent}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0;">
            <div style="flex:1 1 320px;padding:6px 16px 12px;border-right:1px dashed rgba(139,94,60,.3);">
              <div style="font-size:14px;color:#5c3319;border-bottom:1px solid rgba(139,94,60,.3);padding-bottom:5px;margin-bottom:16px;">Вклад каждого сигнала</div>
              ${signalsHTML}
            </div>
            <div style="flex:1 1 320px;padding:6px 16px 12px;">
              <div style="font-size:14px;color:#5c3319;border-bottom:1px solid rgba(139,94,60,.3);padding-bottom:5px;margin-bottom:10px;">Из чего складывается уверенность ${confidence}%</div>
              ${factorsHTML}
            </div>
          </div>
        </div>
      </div>
    </div>`
  }

  function renderDiary() {
    const pctMapAll = Object.fromEntries(contributions.map(c => [c.id, c.percent]))
    const eventsHTML = events.map(e => {
      const meta = allEventMeta[e.event] ?? { emoji: '?', label: e.event }, pct = pctMapAll[e.id]??0
      const isEditing = editingId === e.id, draft = editDrafts[e.id] ?? e
      const editForm = isEditing ? `<div style="background:rgba(255,255,255,.55);border:1px solid #c9a35f;border-top:none;border-radius:0 0 5px 5px;padding:12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Тип сигнала
            ${renderSelect('sel_ev_' + e.id, allEventTypes.map(t => ({value: t, label: allEventMeta[t].emoji + ' ' + allEventMeta[t].label})), draft.event, "window._BF.updateDraftField('" + e.id + "','event',VALUE)")}
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Место
            ${renderSelect('sel_loc_' + e.id, LOCATIONS.map(l => ({value: l, label: l})), draft.location, "window._BF.updateDraftField('" + e.id + "','location',VALUE)")}
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Время
            <input type="time" value="${draft.time}" onchange="window._BF.updateDraftField('${e.id}','time',this.value)" style="padding:3px 5px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Сколько раз
            <input type="number" min="1" max="20" value="${draft.count}" onchange="window._BF.updateDraftCount('${e.id}',this.value)" style="padding:3px 5px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Заметность (1–10)
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="range" min="1" max="10" step="1" value="${draft.intensity}" oninput="this.nextElementSibling.textContent=this.value" onchange="window._BF.updateDraftIntensity('${e.id}',this.value)" style="flex:1;" />
            <span style="min-width:18px;text-align:right;color:#3d1f00;font-weight:bold;">${draft.intensity}</span>
          </div>
        </label>
        <div style="display:flex;gap:8px;align-items:center;">
          <div onclick="window._BF.saveEdit('${e.id}')" style="background:#e8a020;border:2px solid #8b5e3c;color:#3d1f00;padding:4px 14px;border-radius:4px;font-weight:bold;cursor:pointer;box-shadow:2px 2px 0 rgba(0,0,0,.3);">✓ Сохранить</div>
          <div onclick="window._BF.cancelEdit()" style="border:1px solid #8b5e3c;color:#7a5235;padding:4px 10px;border-radius:4px;cursor:pointer;">Отмена</div>
          <div onclick="window._BF.deleteEvent('${e.id}')" style="margin-left:auto;background:#c84b0f;border:2px solid #8b2500;color:#fff;padding:3px 10px;border-radius:4px;cursor:pointer;">Удалить</div>
        </div>
      </div>` : ''
      return `<div style="margin-bottom:8px;">
        <div onclick="window._BF.startEdit('${e.id}')" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.42);border:1px solid #c9a35f;border-radius:5px;padding:7px 10px;cursor:pointer;font-size:.92rem;">
          <span style="font-size:1.1rem;">${meta.emoji}</span>
          <span style="flex:1;">${meta.label} <span style="color:#7a5235;">· ${e.location}</span></span>
          <span style="color:#7a5235;font-size:.82rem;">${e.time}</span>
          <span style="color:#7a5235;font-size:.82rem;">×${e.count}</span>
          <span style="color:${pct>=20?'#c84b0f':'#7a5235'};font-size:.82rem;min-width:32px;text-align:right;">${pct>0?pct+'%':'—'}</span>
        </div>${editForm}
      </div>`
    }).join('')

    const addForm = (isAddingNew && newDraft) ? `<div style="background:rgba(255,255,255,.55);border:1px solid #c9a35f;border-radius:5px;padding:12px;display:flex;flex-direction:column;gap:8px;margin-top:6px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Тип сигнала
          ${renderSelect('sel_new_ev', allEventTypes.map(t => ({value: t, label: allEventMeta[t].emoji + ' ' + allEventMeta[t].label})), newDraft.event, "window._BF.updateNewDraft('event',VALUE)")}
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Место
          ${renderSelect('sel_new_loc', LOCATIONS.map(l => ({value: l, label: l})), newDraft.location, "window._BF.updateNewDraft('location',VALUE)")}
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Время
          <input type="time" value="${newDraft.time}" onchange="window._BF.updateNewDraft('time',this.value)" style="padding:3px 5px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Сколько раз
          <input type="number" min="1" max="20" value="${newDraft.count}" onchange="window._BF.updateNewCount(this.value)" style="padding:3px 5px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;" />
        </label>
      </div>
      <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Заметность (1–10)
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="range" min="1" max="10" step="1" value="${newDraft.intensity}" oninput="this.nextElementSibling.textContent=this.value" onchange="window._BF.updateNewIntensity(this.value)" style="flex:1;" />
          <span style="min-width:18px;text-align:right;color:#3d1f00;font-weight:bold;">${newDraft.intensity}</span>
        </div>
      </label>
      <div style="display:flex;gap:8px;">
        <div onclick="window._BF.saveNewEvent()" style="background:#e8a020;border:2px solid #8b5e3c;color:#3d1f00;padding:4px 14px;border-radius:4px;font-weight:bold;cursor:pointer;box-shadow:2px 2px 0 rgba(0,0,0,.3);">✓ Добавить</div>
        <div onclick="window._BF.cancelNewEvent()" style="border:1px solid #8b5e3c;color:#7a5235;padding:4px 10px;border-radius:4px;cursor:pointer;">Отмена</div>
      </div>
    </div>` : ''

    const { llmRecs, llmLoading } = state
    const recs = (Array.isArray(llmRecs) && llmRecs.length > 0) ? llmRecs : buildFallbackRecs(rabbits, confidence, events, byZone)
    const isLlm = Array.isArray(llmRecs) && llmRecs.length > 0
    const recsNote = llmLoading
      ? `<div style="font-size:.8rem;color:#7a5235;margin-bottom:6px;">⏳ Запрашиваю AI-рекомендации…</div>`
      : isLlm
        ? `<div style="font-size:.8rem;color:#4caf50;margin-bottom:6px;">✨ Рекомендации от AI (claude-haiku)</div>`
        : `<div style="font-size:.8rem;color:#7a5235;margin-bottom:6px;">ℹ️ Правила на основе данных — AI недоступен</div>`
    const recsHTML = recs.map(r => `<div style="display:flex;gap:8px;padding:8px 10px;background:rgba(232,160,32,.14);border:1px solid rgba(232,160,32,.4);border-radius:5px;font-size:.88rem;line-height:1.4;"><span style="color:#e8a020;">→</span><span>${r}</span></div>`).join('')

    return `<div style="position:fixed;inset:0;background:rgba(20,14,8,.55);z-index:100;display:flex;align-items:center;justify-content:center;">
      <div style="position:relative;width:min(1140px,94vw);height:min(720px,90vh);animation:bookIn .18s ease-out;">
        <div style="position:absolute;inset:-16px;background:#7a4a2a;border-radius:16px;border:4px solid #3d1f00;z-index:-1;box-shadow:0 26px 60px rgba(0,0,0,.55);"></div>
        <div style="display:flex;width:100%;height:100%;border-radius:10px;overflow:hidden;">
          <div style="flex:1.15;background:linear-gradient(180deg,#f5e6c8,#ead5b0);padding:22px 24px;overflow-y:auto;box-shadow:inset -10px 0 24px rgba(0,0,0,.12);">
            <div style="font-size:1.3rem;color:#3d1f00;margin-bottom:2px;">Дневник фермера</div>
            <div style="font-size:.85rem;color:#7a5235;margin-bottom:10px;">Журнал сигналов о кроликах (${events.length})</div>
            <input type="file" id="bf-import-file" accept=".json" style="display:none;" onchange="window._BF.handleImportFile(this)" />
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
              <div onclick="window._BF.exportEvents()" style="display:inline-flex;align-items:center;gap:5px;background:rgba(92,51,25,.1);border:2px solid #8b5e3c;color:#5c3319;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.82rem;">📤 Экспорт</div>
              <div onclick="window._BF.importEvents()" style="display:inline-flex;align-items:center;gap:5px;background:rgba(92,51,25,.1);border:2px solid #8b5e3c;color:#5c3319;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.82rem;">📥 Импорт</div>
              <div onclick="window._BF.downloadPdf()" style="display:inline-flex;align-items:center;gap:5px;background:rgba(92,51,25,.1);border:2px solid #8b5e3c;color:#5c3319;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.82rem;">${pdfLoading ? '⏳ PDF…' : '📄 PDF отчёт'}</div>
            </div>
            ${importError ? `<div style="font-size:.82rem;color:#c84b0f;background:rgba(200,75,15,.08);border:1px solid rgba(200,75,15,.3);border-radius:4px;padding:6px 10px;margin-bottom:10px;">⚠️ ${importError}</div>` : ''}
            ${eventsHTML}${addForm}
            ${!isAddingNew?`<div onclick="window._BF.startAddEvent()" style="margin-top:10px;display:inline-block;background:#e8a020;border:2px solid #8b5e3c;color:#3d1f00;padding:6px 16px;border-radius:4px;font-weight:bold;cursor:pointer;box-shadow:2px 2px 0 rgba(0,0,0,.3);">+ Добавить наблюдение</div>`:''}
          </div>
          <div style="width:2px;background:linear-gradient(rgba(0,0,0,.15),rgba(0,0,0,0),rgba(0,0,0,.15));flex-shrink:0;"></div>
          <div style="flex:1;background:linear-gradient(180deg,#f5e6c8,#ead5b0);padding:22px 24px;overflow-y:auto;position:relative;box-shadow:inset 10px 0 24px rgba(0,0,0,.12);">
            <div onclick="window._BF.closeDiary()" style="position:absolute;top:16px;right:16px;width:28px;height:28px;background:#c84b0f;border:2px solid #8b2500;border-radius:6px;color:#fff;font-size:.95rem;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</div>
            <div style="font-size:1.3rem;color:#3d1f00;margin-bottom:2px;">🧙 Заключение</div>
            <div style="font-size:.85rem;color:#7a5235;margin-bottom:14px;">Оценка на основе журнала наблюдений</div>
            <div style="display:flex;gap:10px;margin-bottom:14px;">
              <div style="flex:1;background:rgba(122,74,42,.12);border-radius:6px;padding:10px;text-align:center;"><div style="font-size:1.5rem;color:#5c3319;">${rabbitsDisplay} 🐰</div><div style="font-size:.78rem;color:#7a5235;">оценка</div></div>
              <div style="flex:1;background:rgba(122,74,42,.12);border-radius:6px;padding:10px;text-align:center;"><div style="font-size:1.5rem;color:${confColor};">${confidence}%</div><div style="font-size:.78rem;color:#7a5235;">уверенность</div></div>
            </div>
            ${explanation?`<div style="font-size:.9rem;color:#3d1f00;line-height:1.5;margin-bottom:14px;font-style:italic;">${explanation}</div>`:''}
            <div style="font-weight:bold;font-size:.95rem;color:#3d1f00;margin-bottom:4px;">Рекомендации</div>
            ${recsNote}
            <div style="display:flex;flex-direction:column;gap:8px;">${recsHTML}</div>
          </div>
        </div>
      </div>
    </div>`
  }

  document.getElementById('root').innerHTML = `<div style="min-height:100vh;background:radial-gradient(circle at 20% 10%,rgba(255,255,255,.04),transparent 40%),#1e4d2b;padding:16px;display:flex;flex-direction:column;align-items:center;color:#3d1f00;font-size:16px;"><div style="width:100%;max-width:1100px;display:flex;flex-direction:column;gap:0;">
    <div class="hdr">
      <div class="hdr-left">
        <div class="hdr-title-row">
          <div class="hdr-title">Ферма невидимых кроликов</div>
          <div class="hdr-sub">Тестовое задание AI-first Developer · MOX · Карина Ларк</div>
        </div>
        ${explanation?`<div class="hdr-expl"><span style="font-size:14px;flex-shrink:0;">📜</span><span>${explanation}</span></div>`:''}
        <div class="hdr-tabs">${tabsHTML}</div>
      </div>
      <div class="hdr-right">
        <div class="hdr-btn" onclick="window._BF.openScorePopup()" style="background:#2b1c10;border:2px solid #1a1008;" title="Разбор оценки">
          <span style="font-size:18px;">🥕</span>
          <div style="color:#f0dcae;font-size:12px;line-height:1.2;white-space:nowrap;">
            <div style="font-weight:800;font-size:15px;">≈ ${rabbitsDisplay} кроликов</div>
            <div style="opacity:.8;">уверенность ${confidence}%</div>
          </div>
        </div>
        <div class="hdr-btn" onclick="window._BF.openDiary()" style="background:linear-gradient(#a97a4a,#7a4a2a);border:2px solid #4a2c14;box-shadow:0 2px 0 #2b1c10;">
          <span style="font-size:17px;">📖</span>
          <span style="color:#f0dcae;font-weight:800;font-size:13px;white-space:nowrap;">Дневник фермера</span>
        </div>
      </div>
    </div>
    ${scoreOpen ? renderScorePopup() : ''}
    <div style="margin-top:14px;background:linear-gradient(180deg,#f5e6c8 0%,#ead5b0 100%);border:3px solid #8b5e3c;border-radius:0 6px 6px 6px;box-shadow:4px 4px 0 rgba(0,0,0,.35);padding:18px;position:relative;${activeTab!=='map'?'max-height:calc(100vh - 220px);overflow-y:auto;':''}">
      ${activeTab==='map'?renderMap():activeTab==='settings'?renderSettings():renderWorklog()}
    </div>
    ${diaryOpen ? renderDiary() : ''}
  </div></div>`
}

render()

function fetchLlmRecs() {
  setState({ llmLoading: true })
  const { events, params } = state
  const allTypeCount = EVENT_TYPES.length + state.customEventTypes.length
  const rabbits      = calculateRabbits(events, params)
  const confidence   = calculateConfidence(events, params, allTypeCount)
  const byZone       = calculateByZone(events, params)
  const contributions = calculateContributions(events, params)
    .map(c => ({ id: c.id, percent: c.percent ?? 0 }))
  fetch('/api/advise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rabbits, confidence, events, contributions, byZone, params }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      const recs = Array.isArray(data?.recommendations) && data.recommendations.length
        ? data.recommendations : null
      setState({ llmRecs: recs, llmLoading: false })
    })
    .catch(() => setState({ llmLoading: false }))
}

fetchLlmRecs()
