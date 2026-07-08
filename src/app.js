// Vanilla JS app shell — imports the production model, data & explainer
import {
  DEFAULT_PARAMS,
  calculateRabbits,
  calculateConfidence,
  calculateByZone,
  calculateContributions,
  latestEventTime,
  freshnessMultiplier,
} from './model.js'
import {
  INITIAL_EVENTS,
  EVENT_META,
  EVENT_TYPES,
  LOCATIONS,
} from './data.js'
import { rabbitRange } from './rabbitRange.js'
import { buildSubtitle } from './explainer.js'
import { getConfidenceFactors } from './confidence.js'

/* ═══════════════════════════════════════════════
   STATIC DATA
═══════════════════════════════════════════════ */
const ZONE_LAYOUT = {
  'Огород':   { left:6.2,  top:4.5,  width:38.5, height:41.9 },
  'У забора': { left:51.8, top:4.5,  width:45.0, height:41.9 },
  'Сарай':    { left:3.2,  top:54.2, width:42.7, height:41.3 },
  'Теплица':  { left:51.8, top:54.2, width:45.0, height:41.3 },
}
const ZONE_COLORS = {
  'Огород':   'rgba(60,120,30,.18)',
  'У забора': 'rgba(140,100,40,.18)',
  'Сарай':    'rgba(80,60,40,.22)',
  'Теплица':  'rgba(80,180,80,.16)',
}
const MOVEMENT_PRESETS  = [{label:'медленно',value:60},{label:'средне',value:30},{label:'быстро',value:15}]
const FRESHNESS_PRESETS = [{label:'быстро',value:60},{label:'средне',value:180},{label:'медленно',value:360}]
const WORKLOG = [
  { status:'done', title:'Анализ задания и архитектурные решения' },
  { status:'done', title:'Модель расчёта (src/model.js)' },
  { status:'done', title:'Юнит-тесты (vitest, 22 кейса)' },
  { status:'done', title:'UI: тема Stardew Valley, иллюстрированная карта, попапы' },
  { status:'todo', title:'FastAPI бэкенд + интеграция Anthropic API' },
  { status:'todo', title:'Docker + docker-compose' },
  { status:'todo', title:'README и итоговая документация' },
]

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let state = {
  events:       INITIAL_EVENTS.map(e => ({...e})),
  params:       { ...DEFAULT_PARAMS, rabbitsPerUnit:{...DEFAULT_PARAMS.rabbitsPerUnit}, reliability:{...DEFAULT_PARAMS.reliability} },
  activeTab:    'map',
  activeZone:   null,
  showScore:    false,
  showDiary:    false,
  editingEvt:   null,
  addingInZone: null,
  nextId:       6,
  llmText:      null,
}

function setState(patch) {
  state = {...state, ...patch}
  render()
}

/* ═══════════════════════════════════════════════
   EVENT MANAGEMENT
═══════════════════════════════════════════════ */
function addEvent(data) {
  const id = 'evt_' + String(state.nextId).padStart(3, '0')
  setState({ events:[...state.events,{...data,id}], nextId:state.nextId+1, addingInZone:null })
}
function updateEvent(id, patch) {
  setState({ events:state.events.map(e => e.id===id?{...e,...patch}:e), editingEvt:null })
}
function deleteEvent(id) {
  setState({ events:state.events.filter(e => e.id!==id) })
}
// Expose to inline handlers
window._BF = { addEvent, updateEvent, deleteEvent, setState, state: () => state }

/* ═══════════════════════════════════════════════
   DERIVED / HELPER
═══════════════════════════════════════════════ */
function confidenceClass(c) { return c>=70?'ch':c>=40?'cm':'cl' }
function heatClass(v, max) { if(!max||v===0) return ''; const r=v/max; return r<.33?'heat-1':r<.67?'heat-2':'heat-3' }

function buildFallbackRecs(rabbits, confidence, events, byZone) {
  const recs = []
  const sorted = Object.entries(byZone).sort((a,b)=>b[1]-a[1]).filter(([,v])=>v>0)
  if (sorted.length) recs.push(`Расставьте ловушки в зоне «${sorted[0][0]}» — там наибольшая активность (~${sorted[0][1].toFixed(1)}).`)
  const types = new Set(events.map(e=>e.event))
  if (types.size < 3) recs.push('Добавьте больше типов наблюдений: разнообразие сигналов повышает точность.')
  if (confidence < 50) recs.push('Уверенность низкая — добавьте свежие события или проверьте настройки модели.')
  if (rabbits > 5) recs.push('Высокая активность. Рекомендуем усилить мониторинг по всей ферме.')
  if (!recs.length) recs.push('Продолжайте сбор данных для уточнения оценки.')
  return recs
}

function generateAiText(rabbits, conf, byZone, recs) {
  if (!state.events.length) return '<p>Дневник пуст. Начните записывать наблюдения на карте фермы.</p>'
  const cw = conf>=70?'высокой':conf>=40?'средней':'низкой'
  const ccls = conf>=70?'fok':conf>=40?'fwarn':'fbad'
  const top = Object.entries(byZone).sort((a,b)=>b[1]-a[1]).find(([,v])=>v>0)
  const rng = rabbitRange(rabbits)
  return `<p>На основе <strong>${state.events.length} событий</strong> система оценивает численность кроликов в <strong>${rng==='0'?'0':rng+'&nbsp;кролика(ов)'}</strong>.</p>
<p>Уверенность: <strong class="${ccls}">${conf}% (${cw})</strong>${top?`. Наибольшая активность в «${top[0]}»`:''}.
</p>
<p><strong>Рекомендации:</strong></p>
${recs.map(r=>`<p>• ${r}</p>`).join('')}
${state.llmText ? `<div class="divider"></div><p><strong>AI-анализ (сервер):</strong></p><p>${state.llmText}</p>` : ''}
<p style="margin-top:10px;font-size:14px;color:#7a5235"><em>⚠ Для AI-вывода подключите бэкенд Anthropic API (FastAPI, в разработке).</em></p>`
}

/* ═══════════════════════════════════════════════
   RENDER: HEADER
═══════════════════════════════════════════════ */
function renderHeader(rabbits, conf, byZone) {
  const sub = buildSubtitle(rabbits, byZone, state.events, state.params, EVENT_META)
  return `<div class="header">
  <div class="header-left">
    <div class="title">🐇 Невидимая Кроличья Ферма</div>
    <div class="subtitle">${sub}</div>
    <div class="explanation">Оценка популяции по косвенным признакам · AI-first dev test task</div>
  </div>
  <div class="header-right">
    <div class="tabs">
      ${[['map','🗺 Карта'],['settings','⚙ Параметры'],['worklog','📓 Журнал']].map(([t,l])=>
        `<button class="tab${state.activeTab===t?' active':''}" onclick="_BF.setState({activeTab:'${t}',activeZone:null,editingEvt:null,addingInZone:null})">${l}</button>`
      ).join('')}
    </div>
    <button class="btn" onclick="_BF.setState({showScore:true})">🐇 ${Math.round(rabbits)}</button>
    <button class="btn btn-ghost" onclick="_BF.setState({showDiary:true})">📖 Дневник</button>
  </div>
</div>`
}

/* ═══════════════════════════════════════════════
   RENDER: MAP TAB
═══════════════════════════════════════════════ */
function renderMapTab(byZone) {
  const maxZ = Math.max(...Object.values(byZone), 0.01)

  const zonesHtml = LOCATIONS.map(loc => {
    const z    = ZONE_LAYOUT[loc]
    const cnt  = byZone[loc] ?? 0
    const evts = state.events.filter(e => e.location===loc)
    const hc   = heatClass(cnt, maxZ)
    return `<div class="zone" style="left:${z.left}%;top:${z.top}%;width:${z.width}%;height:${z.height}%;background:${ZONE_COLORS[loc]};${state.activeZone===loc?'outline:2px solid #e8a020;':''}"
      onclick="_BF.setState({activeZone:_BF.state().activeZone==='${loc}'?null:'${loc}',editingEvt:null,addingInZone:null})">
      <span class="zone-label">${loc}${evts.length?` (${evts.length})`:''}</span>
      ${cnt>0?`<span class="zone-badge ${hc}">~${cnt.toFixed(1)}</span>`:''}
    </div>`
  }).join('')

  const sprites = [
    { src:'sv-well.png',       l:46.5, t:44, w:7 },
    { src:'sv-bush-a.png',     l:2,    t:46, w:6 },
    { src:'sv-bush-b.png',     l:91,   t:11, w:6 },
    { src:'sv-bush-a.png',     l:88,   t:46, w:5 },
    { src:'sv-cauliflower.png',l:12,   t:14, w:5 },
    { src:'sv-strawberry.png', l:25,   t:27, w:5 },
    { src:'crop-leafy.png',    l:59,   t:62, w:5 },
    { src:'crop-potted.png',   l:75,   t:72, w:5 },
    { src:'sv-cabin.png',      l:8,    t:62, w:8 },
    { src:'sv-grass-b.png',    l:38,   t:20, w:4 },
    { src:'sv-grass-a.png',    l:70,   t:30, w:4 },
  ].map(s=>`<img class="sprite" src="/assets/${s.src}" style="left:${s.l}%;top:${s.t}%;width:${s.w}%" onerror="this.style.display='none'">`).join('')

  const popup = state.activeZone ? renderZonePopup(state.activeZone, byZone) : ''

  return `<div>
  <div class="map-wrap">
    <div class="map-inner">
      <div class="map-bg"></div>
      <div class="map-path map-path-h"></div>
      <div class="map-path map-path-v"></div>
      ${sprites}
      ${zonesHtml}
      ${popup}
    </div>
  </div>
  <div style="margin-top:8px;font-size:15px;color:#5c3319;text-align:center">Кликните на зону для просмотра и редактирования событий</div>
</div>`
}

/* ═══════════════════════════════════════════════
   RENDER: ZONE POPUP
═══════════════════════════════════════════════ */
function renderZonePopup(loc, byZone) {
  const z    = ZONE_LAYOUT[loc]
  const evts = state.events.filter(e => e.location===loc)
  const cnt  = byZone[loc] ?? 0

  // Keep popup on-screen
  const pl = z.left + z.width + 1 > 93 ? z.left - 43 : z.left + z.width + 1
  const pt = Math.min(z.top, 52)

  const evtsHtml = evts.length
    ? evts.map(e => {
        if (state.editingEvt === e.id) return editForm(e)
        const m = EVENT_META[e.event] ?? { emoji:'?', label:e.event }
        return `<div class="zone-evt">
          <span style="font-size:18px;flex-shrink:0">${m.emoji}</span>
          <span class="zone-evt-info">${m.label}<br>
            <span style="color:#7a5235;font-size:13px">${e.count}&nbsp;шт · сила&nbsp;${e.intensity} · ${e.time}</span>
          </span>
          <span class="zone-evt-actions">
            <button class="btn btn-sm" onclick="_BF.setState({editingEvt:'${e.id}'})">✏</button>
            <button class="btn btn-sm btn-red" onclick="_BF.deleteEvent('${e.id}')">✕</button>
          </span>
        </div>`
      }).join('')
    : '<div style="font-size:15px;color:#7a5235;padding:4px 0">Событий нет</div>'

  const addHtml = state.addingInZone === loc
    ? addForm(loc)
    : `<button class="btn btn-sm" style="margin-top:6px" onclick="_BF.setState({addingInZone:'${loc}'})">+ Добавить событие</button>`

  return `<div class="zone-popup" style="left:${pl}%;top:${pt}%;right:auto;bottom:auto">
  <div class="zpop-title">
    <span>${loc}${cnt>0?` (~${cnt.toFixed(1)} 🐇)`:''}</span>
    <button class="zpop-close" onclick="_BF.setState({activeZone:null,editingEvt:null,addingInZone:null})">✕</button>
  </div>
  ${evtsHtml}
  <div class="divider"></div>
  ${addHtml}
</div>`
}

function editForm(e) {
  const opts = EVENT_TYPES.map(t => `<option value="${t}" ${t===e.event?'selected':''}>${EVENT_META[t]?.emoji} ${EVENT_META[t]?.label}</option>`).join('')
  return `<div class="evt-form">
    <label>Тип</label><select id="ed-type">${opts}</select>
    <div class="row">
      <div><label>Кол-во</label><input type="number" id="ed-count" value="${e.count}" min="1" max="99"></div>
      <div><label>Сила</label><input type="number" id="ed-int" value="${e.intensity}" min="1" max="10"></div>
      <div><label>Время</label><input type="time" id="ed-time" value="${e.time}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-sm btn-red" onclick="_BF.setState({editingEvt:null})">Отмена</button>
      <button class="btn btn-sm" onclick="_BF.updateEvent('${e.id}',{event:document.getElementById('ed-type').value,count:+document.getElementById('ed-count').value||1,intensity:+document.getElementById('ed-int').value||5,time:document.getElementById('ed-time').value||'00:00'})">Сохранить</button>
    </div>
  </div>`
}

function addForm(loc) {
  const opts = EVENT_TYPES.map(t => `<option value="${t}">${EVENT_META[t]?.emoji} ${EVENT_META[t]?.label}</option>`).join('')
  const now  = new Date().toTimeString().slice(0,5)
  return `<div class="evt-form">
    <label>Тип</label><select id="ad-type">${opts}</select>
    <div class="row">
      <div><label>Кол-во</label><input type="number" id="ad-count" value="1" min="1" max="99"></div>
      <div><label>Сила</label><input type="number" id="ad-int" value="5" min="1" max="10"></div>
      <div><label>Время</label><input type="time" id="ad-time" value="${now}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-sm btn-red" onclick="_BF.setState({addingInZone:null})">Отмена</button>
      <button class="btn btn-sm" onclick="_BF.addEvent({event:document.getElementById('ad-type').value,location:'${loc}',count:+document.getElementById('ad-count').value||1,intensity:+document.getElementById('ad-int').value||5,time:document.getElementById('ad-time').value||'00:00'})">Добавить</button>
    </div>
  </div>`
}

/* ═══════════════════════════════════════════════
   RENDER: SETTINGS TAB
═══════════════════════════════════════════════ */
function renderSettingsTab() {
  const p = state.params
  const mP = MOVEMENT_PRESETS.find(x=>x.value===p.movementWindowMinutes)
  const fP = FRESHNESS_PRESETS.find(x=>x.value===p.freshnessWindowMinutes)

  const mkSlider = (group, t, min, max, step, isRel) => {
    const m    = EVENT_META[t]
    const val  = p[group][t]
    const disp = isRel ? Math.round(val*100)+'%' : val.toFixed(1)
    const upd  = isRel
      ? `(function(){const v=+this.value;_BF.setState({params:{..._BF.state().params,${group}:{..._BF.state().params.${group},'${t}':v}}});document.getElementById('sv-${group}-${t}').textContent=Math.round(v*100)+'%'})()`
      : `(function(){const v=+this.value;_BF.setState({params:{..._BF.state().params,${group}:{..._BF.state().params.${group},'${t}':v}}});document.getElementById('sv-${group}-${t}').textContent=v.toFixed(1)})()`
    return `<div class="slider-row">
      <span class="slider-label">${m?.emoji} ${m?.label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" oninput="${upd.replace(/"/g,"'")}">
      <span class="slider-val" id="sv-${group}-${t}">${disp}</span>
    </div>`
  }

  return `<div class="parchment">
  <div class="settings-section">
    <h3>🐾 Скорость перемещения кроликов</h3>
    <p class="settings-note">Временное окно группировки событий (мин)</p>
    <div class="preset-row">
      ${MOVEMENT_PRESETS.map(pr=>`<button class="preset-btn${mP?.value===pr.value?' active':''}"
        onclick="_BF.setState({params:{..._BF.state().params,movementWindowMinutes:${pr.value}}})">${pr.label} (${pr.value}&nbsp;мин)</button>`).join('')}
    </div>
  </div>
  <div class="settings-section">
    <h3>⏱ Скорость устаревания следов</h3>
    <p class="settings-note">Время полного устаревания сигнала (мин)</p>
    <div class="preset-row">
      ${FRESHNESS_PRESETS.map(pr=>`<button class="preset-btn${fP?.value===pr.value?' active':''}"
        onclick="_BF.setState({params:{..._BF.state().params,freshnessWindowMinutes:${pr.value}}})">${pr.label} (${pr.value}&nbsp;мин)</button>`).join('')}
    </div>
  </div>
  <div class="settings-section">
    <h3>📊 Кроликов на единицу сигнала</h3>
    ${EVENT_TYPES.map(t=>mkSlider('rabbitsPerUnit',t,0.1,3,0.1,false)).join('')}
  </div>
  <div class="settings-section">
    <h3>✅ Надёжность типа сигнала</h3>
    ${EVENT_TYPES.map(t=>mkSlider('reliability',t,0.1,1,0.05,true)).join('')}
  </div>
  <div style="margin-top:10px">
    <button class="btn btn-red btn-sm" onclick="_BF.setState({params:{rabbitsPerUnit:{...${JSON.stringify(DEFAULT_PARAMS.rabbitsPerUnit)}},reliability:{...${JSON.stringify(DEFAULT_PARAMS.reliability)}},movementWindowMinutes:${DEFAULT_PARAMS.movementWindowMinutes},freshnessWindowMinutes:${DEFAULT_PARAMS.freshnessWindowMinutes}}})">Сбросить к умолчаниям</button>
  </div>
</div>`
}

/* ═══════════════════════════════════════════════
   RENDER: WORKLOG TAB
═══════════════════════════════════════════════ */
function renderWorklogTab() {
  const done = WORKLOG.filter(w=>w.status==='done').length
  return `<div class="parchment">
  <div class="diary-page-title" style="margin-bottom:12px">
    📓 Журнал работ — ${done}/${WORKLOG.length} выполнено
  </div>
  ${WORKLOG.map(w=>`<div class="worklog-item">
    <span class="${w.status==='done'?'s-done':'s-todo'}" style="font-size:20px">${w.status==='done'?'✅':'⬜'}</span>
    <span style="${w.status==='done'?'text-decoration:line-through;color:#7a7a5a':''}">${w.title}</span>
  </div>`).join('')}
  <div style="margin-top:16px;font-size:16px;color:#7a5235">Выполнено: ${done} · Осталось: ${WORKLOG.length-done}</div>
</div>`
}

/* ═══════════════════════════════════════════════
   RENDER: SCORE POPUP
═══════════════════════════════════════════════ */
function renderScorePopup(rabbits, conf, byZone) {
  const contribs = calculateContributions(state.events, state.params)
  const factors  = getConfidenceFactors(state.events, state.params)
  const rng      = rabbitRange(rabbits)
  const cc       = confidenceClass(conf)
  const recs     = buildFallbackRecs(rabbits, conf, state.events, byZone)

  const factorRows = Object.entries(factors).map(([k, v]) => {
    const label = {diversity:'Разнообразие сигналов',avgIntensity:'Средняя интенсивность',consistency:'Согласованность зон'}[k] ?? k
    const pct   = Math.round(v*100)
    const cls   = pct>=66?'fok':pct>=33?'fwarn':'fbad'
    return `<div class="score-row"><span class="score-row-label">${label}</span><span class="score-row-val ${cls}">${pct}%</span></div>`
  }).join('')

  return `<div class="overlay" onclick="if(event.target.classList.contains('overlay'))_BF.setState({showScore:false})">
  <div class="score-modal" onclick="event.stopPropagation()">
    <div class="score-title">🐇 Оценка популяции</div>
    <span class="rabbit-num">${Math.round(rabbits)}</span>
    <div class="rabbit-range-txt">${rng === '0' ? '0 кроликов' : rng + ' кроликов'}</div>
    <div class="conf-bar-bg"><div class="conf-bar-fill ${cc}" style="width:${conf}%"></div></div>
    <div class="conf-lbl ${cc}">Уверенность: ${conf}%</div>
    <div class="divider"></div>
    <div class="score-section">
      <h4>По зонам</h4>
      ${LOCATIONS.map(loc=>{const v=byZone[loc]??0;return v>0?`<div class="score-row"><span class="score-row-label">${loc}</span><span class="score-row-val">~${v.toFixed(1)}</span></div>`:''}).join('')||'<div style="color:#7a5235;font-size:16px">Нет данных</div>'}
    </div>
    ${contribs.length?`<div class="score-section">
      <h4>Вклад сигналов</h4>
      ${[...contribs].sort((a,b)=>(b.percent??0)-(a.percent??0)).map(e=>{
        const m=EVENT_META[e.event]??{emoji:'?',label:e.event}
        return `<div class="score-row">
          <span class="score-row-label">${m.emoji} ${m.label} · ${e.event!==e.location?'': ''}${state.events.find(ev=>ev.id===e.id)?.location??''} · ${state.events.find(ev=>ev.id===e.id)?.time??''}</span>
          <span class="score-row-val">${e.percent??0}%</span>
        </div>`
      }).join('')}
    </div>`:''}
    ${factorRows?`<div class="score-section"><h4>Факторы уверенности</h4>${factorRows}</div>`:''}
    ${recs.length?`<div class="score-section">
      <h4>Рекомендации</h4>
      ${recs.map(r=>`<div style="font-size:16px;color:#3d1f00;padding:3px 0;border-bottom:1px solid #c4a06c">• ${r}</div>`).join('')}
    </div>`:''}
    <div style="text-align:right;margin-top:12px">
      <button class="btn btn-red btn-sm" onclick="_BF.setState({showScore:false})">Закрыть</button>
    </div>
  </div>
</div>`
}

/* ═══════════════════════════════════════════════
   RENDER: DIARY MODAL
═══════════════════════════════════════════════ */
function renderDiaryModal(rabbits, conf, byZone) {
  const sorted = [...state.events].sort((a,b)=>a.time.localeCompare(b.time))
  const recs   = buildFallbackRecs(rabbits, conf, state.events, byZone)
  const ai     = generateAiText(rabbits, conf, byZone, recs)

  return `<div class="overlay" onclick="if(event.target.classList.contains('overlay'))_BF.setState({showDiary:false})">
  <div class="diary-modal" onclick="event.stopPropagation()">
    <div class="diary-page">
      <div class="diary-page-title">
        📔 Полевой дневник
        <button class="zpop-close" onclick="_BF.setState({showDiary:false})">✕</button>
      </div>
      ${sorted.length ? sorted.map(e=>{
        const m=EVENT_META[e.event]??{emoji:'?',label:e.event}
        return `<div class="diary-entry">
          <span class="diary-entry-time">${e.time} · ${e.location}</span>
          ${m.emoji} ${m.label} — ${e.count}&nbsp;шт., сила&nbsp;${e.intensity}/10
        </div>`
      }).join('') : '<div style="color:#7a5235;font-size:16px">Событий не записано</div>'}
    </div>
    <div class="diary-page">
      <div class="diary-page-title">🤖 Анализ</div>
      <div class="diary-ai">${ai}</div>
    </div>
  </div>
</div>`
}

/* ═══════════════════════════════════════════════
   MAIN RENDER
═══════════════════════════════════════════════ */
function render() {
  const rabbits = calculateRabbits(state.events, state.params)
  const conf    = calculateConfidence(state.events, state.params, EVENT_TYPES.length)
  const byZone  = calculateByZone(state.events, state.params)

  let html = renderHeader(rabbits, conf, byZone)
  html += '<div class="main">'

  if (state.activeTab === 'map') {
    html += renderMapTab(byZone)
  } else if (state.activeTab === 'settings') {
    html += renderSettingsTab()
  } else if (state.activeTab === 'worklog') {
    html += renderWorklogTab()
  }

  html += '</div>'

  if (state.showScore) html += renderScorePopup(rabbits, conf, byZone)
  if (state.showDiary) html += renderDiaryModal(rabbits, conf, byZone)

  document.getElementById('root').innerHTML = html

  // Keep _BF.state() reference fresh (closures don't update)
  window._BF.state = () => state
}

/* ═══════════════════════════════════════════════
   LLM polling (fire-and-forget, non-blocking)
═══════════════════════════════════════════════ */
function tryFetchAdvise() {
  const { events, params } = state
  if (!events.length) return
  const rabbits     = calculateRabbits(events, params)
  const confidence  = calculateConfidence(events, params, EVENT_TYPES.length)
  const byZone      = calculateByZone(events, params)
  const contribs    = calculateContributions(events, params)
  fetch('/api/advise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rabbits, confidence, events, contributions:contribs, byZone, params }),
    signal: AbortSignal.timeout(15000),
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data?.text) setState({ llmText: data.text }) })
    .catch(() => {})
}

render()
// Try to get AI text on load (silently fails if backend is down)
setTimeout(tryFetchAdvise, 500)
