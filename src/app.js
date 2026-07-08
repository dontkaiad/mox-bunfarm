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
      events: [...s.events, { ...b, id: 'evt_' + Date.now(), time: now }],
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
}

// ── render ─────────────────────────────────────────────────────────────────
function render() {
  const { events, params, activeZone, activeTab, diaryOpen, scoreOpen, editingId, editDrafts, isAddingNew, newDraft, explainerOpen } = state

  const rabbits = calculateRabbits(events, params)
  const confidence = calculateConfidence(events, params, EVENT_TYPES.length)
  const contributions = calculateContributions(events, params)
  const byZone = calculateByZone(events, params)
  const explanation = buildSubtitle(rabbits, byZone, events, params, EVENT_META)
  const confColor = confidence >= 70 ? '#7fff7f' : confidence >= 40 ? '#ffe066' : '#ff9966'
  const rabbitsDisplay = rabbitRange(rabbits)

  const tabsHTML = ['map','settings','worklog'].map((id, i) => {
    const labels = ['Карта', 'Настройка модели', 'AI Worklog']
    const active = activeTab === id
    return `<div onclick="window._BF.setTab('${id}')" style="width:170px;text-align:center;padding:10px 12px;font-weight:700;font-size:14px;color:${active?'#3a2415':'#f0dcae'};background:${active?'#f0dcae':'rgba(0,0,0,.16)'};border:${active?'2px solid #e0a83c':'2px solid rgba(240,220,174,.35)'};box-shadow:${active?'0 -2px 0 #e0a83c inset':'none'};border-radius:6px 6px 0 0;white-space:nowrap;cursor:pointer;flex-shrink:0;box-sizing:border-box;">${labels[i]}</div>`
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
        ${count>0?`<div style="position:absolute;right:8px;top:8px;width:26px;height:26px;border-radius:50%;background:#e8a020;border:2px solid #5c3319;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:bold;color:#3d1f00;">${count}</div>`:''}
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
        const meta = EVENT_META[e.event], pct = pctMap[e.id]??0
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
    const { customButtons, showCqbForm } = state
    const mvHTML = MOVEMENT_PRESETS.map(p => {
      const active = params.movementWindowMinutes === p.value
      return `<div onclick="window._BF.updateMovement(${p.value})" style="flex:1;text-align:center;padding:5px 8px;background:${active?'#e8a020':'rgba(92,51,25,.1)'};border:2px solid #8b5e3c;border-radius:4px;color:${active?'#3d1f00':'#7a5235'};font-size:.95rem;cursor:pointer;">${p.label}</div>`
    }).join('')
    const frHTML = FRESHNESS_PRESETS.map(p => {
      const active = params.freshnessWindowMinutes === p.value
      return `<div onclick="window._BF.updateFreshness(${p.value})" style="flex:1;text-align:center;padding:5px 8px;background:${active?'#e8a020':'rgba(92,51,25,.1)'};border:2px solid #8b5e3c;border-radius:4px;color:${active?'#3d1f00':'#7a5235'};font-size:.95rem;cursor:pointer;">${p.label}</div>`
    }).join('')
    const blocksHTML = EVENT_TYPES.map(type => {
      const meta = EVENT_META[type]
      const relSlider = Math.round(params.reliability[type] * 10)
      const rpuSlider = Math.max(1, Math.min(10, Math.round((params.rabbitsPerUnit[type] - 0.3) / 1.7 * 9 + 1)))
      return `<div style="border-bottom:1px dashed rgba(139,94,60,.3);padding-bottom:10px;">
        <div style="font-size:1rem;color:#5c3319;margin-bottom:5px;">${meta.emoji} ${meta.label}</div>
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
            <span onclick="window._BF.fireCustomButton('${b.id}')" style="cursor:pointer;">${EVENT_META[b.event]?.emoji||'?'} ${b.label}</span>
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
            <select id="cqb-event" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
              ${EVENT_TYPES.map(t=>`<option value="${t}">${EVENT_META[t].emoji} ${EVENT_META[t].label}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Зона
            <select id="cqb-location" style="padding:3px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
              ${LOCATIONS.map(l=>`<option value="${l}">${l}</option>`).join('')}
            </select>
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
    </div>`
  }

  function renderWorklog() {
    return `<div style="display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:1.15rem;color:#5c3319;border-bottom:2px solid #8b5e3c;padding-bottom:6px;">🤖 AI Worklog</div>
      <div style="font-size:.88rem;color:#7a5235;">История решений и чекпоинты разработки — не путать с дневником наблюдений фермера (📖 кнопка в шапке)</div>
      ${WORKLOG.map(w => `<div style="display:flex;gap:12px;padding:9px 10px;border-left:3px solid ${w.status==='done'?'#4caf50':'rgba(139,94,60,.3)'};border-bottom:1px solid rgba(139,94,60,.2);">
        <span style="font-size:1.1rem;flex-shrink:0;">${w.status==='done'?'✅':'⬜'}</span>
        <div style="font-size:.98rem;color:${w.status==='done'?'#3d1f00':'#7a5235'};">${w.title}</div>
      </div>`).join('')}
    </div>`
  }

  function renderScorePopup() {
    const totalVal = contributions.reduce((s, c) => s + c.value, 0)
    const evtMap = Object.fromEntries(events.map(e => [e.id, e]))
    const ranked = [...contributions].sort((a, b) => b.value - a.value).map(c => {
      const evt = evtMap[c.id]; if (!evt) return null
      const meta = EVENT_META[evt.event]
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
      const meta = EVENT_META[e.event], pct = pctMapAll[e.id]??0
      const isEditing = editingId === e.id, draft = editDrafts[e.id] ?? e
      const editForm = isEditing ? `<div style="background:rgba(255,255,255,.55);border:1px solid #c9a35f;border-top:none;border-radius:0 0 5px 5px;padding:12px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Тип сигнала
            <select onchange="window._BF.updateDraftField('${e.id}','event',this.value)" style="padding:4px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
              ${EVENT_TYPES.map(t=>`<option value="${t}"${draft.event===t?' selected':''}>${EVENT_META[t].emoji} ${EVENT_META[t].label}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Место
            <select onchange="window._BF.updateDraftField('${e.id}','location',this.value)" style="padding:4px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
              ${LOCATIONS.map(l=>`<option value="${l}"${draft.location===l?' selected':''}>${l}</option>`).join('')}
            </select>
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
          <select onchange="window._BF.updateNewDraft('event',this.value)" style="padding:4px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
            ${EVENT_TYPES.map(t=>`<option value="${t}"${newDraft.event===t?' selected':''}>${EVENT_META[t].emoji} ${EVENT_META[t].label}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:2px;font-size:.85rem;color:#7a5235;">Место
          <select onchange="window._BF.updateNewDraft('location',this.value)" style="padding:4px 6px;border:1px solid #8b5e3c;border-radius:3px;background:#fff8ec;color:#3d1f00;font-family:inherit;">
            ${LOCATIONS.map(l=>`<option value="${l}"${newDraft.location===l?' selected':''}>${l}</option>`).join('')}
          </select>
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
            <div style="font-size:.85rem;color:#7a5235;margin-bottom:14px;">Журнал сигналов о кроликах (${events.length})</div>
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

  document.getElementById('root').innerHTML = `<div style="min-height:100vh;background:radial-gradient(circle at 20% 10%,rgba(255,255,255,.04),transparent 40%),#1e4d2b;padding:16px;display:flex;flex-direction:column;gap:0;color:#3d1f00;font-size:20px;">
    <div style="background:linear-gradient(#3f5c3a,#2e4429);border:4px solid #1f2f1c;border-radius:8px 8px 0 0;box-shadow:5px 5px 0 rgba(0,0,0,.5);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;flex-wrap:wrap;">
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0;">
        <div style="display:flex;flex-direction:column;gap:1px;">
          <div style="color:#f9e9bc;font-family:'Almendra',serif;font-weight:700;font-size:22px;letter-spacing:.3px;white-space:nowrap;text-shadow:2px 2px 0 rgba(0,0,0,.55),0 0 14px rgba(232,160,32,.25);">Ферма невидимых кроликов</div>
          <div style="color:rgba(255,255,255,.75);font-size:10px;letter-spacing:.3px;white-space:nowrap;">Тестовое задание AI-first Developer · MOX · Карина Ларк</div>
        </div>
        ${explanation?`<div style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.22);border:1px solid rgba(240,220,174,.2);border-radius:6px;padding:6px 12px;color:rgba(245,230,200,.85);font-size:.85rem;line-height:1.4;"><span style="font-size:14px;flex-shrink:0;">📜</span><span>${explanation}</span></div>`:''}
        <div style="display:flex;gap:6px;overflow-x:auto;">${tabsHTML}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;margin-left:auto;">
        <div onclick="window._BF.openScorePopup()" style="width:200px;height:48px;display:flex;align-items:center;justify-content:center;gap:10px;background:#2b1c10;border:2px solid #1a1008;border-radius:8px;padding:0 14px;cursor:pointer;box-sizing:border-box;" title="Разбор оценки">
          <span style="font-size:18px;">🥕</span>
          <div style="color:#f0dcae;font-size:12px;line-height:1.2;white-space:nowrap;">
            <div style="font-weight:800;font-size:15px;">≈ ${rabbitsDisplay} кроликов</div>
            <div style="opacity:.8;">уверенность ${confidence}%</div>
          </div>
        </div>
        <div onclick="window._BF.openDiary()" style="width:200px;height:48px;display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(#a97a4a,#7a4a2a);border:2px solid #4a2c14;border-radius:8px;padding:0 14px;box-shadow:0 2px 0 #2b1c10;cursor:pointer;box-sizing:border-box;">
          <span style="font-size:17px;">📖</span>
          <span style="color:#f0dcae;font-weight:800;font-size:13px;white-space:nowrap;">Дневник фермера</span>
        </div>
      </div>
    </div>
    ${scoreOpen ? renderScorePopup() : ''}
    <div style="margin-top:14px;background:linear-gradient(180deg,#f5e6c8 0%,#ead5b0 100%);border:3px solid #8b5e3c;border-radius:0 6px 6px 6px;box-shadow:4px 4px 0 rgba(0,0,0,.35);padding:18px;min-height:600px;position:relative;">
      ${activeTab==='map'?renderMap():activeTab==='settings'?renderSettings():renderWorklog()}
    </div>
    ${diaryOpen ? renderDiary() : ''}
  </div>`
}

render()

function fetchLlmRecs() {
  setState({ llmLoading: true })
  fetch('/api/advise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: state.events, params: state.params }),
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const recs = data?.recommendations ?? data?.recs ?? null
      setState({ llmRecs: Array.isArray(recs) ? recs : null, llmLoading: false })
    })
    .catch(() => setState({ llmLoading: false }))
}

fetchLlmRecs()
