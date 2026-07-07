// Shared plain-language text generators used by EstimateBreakdown (UI) and
// pdfReport (PDF). Keep in sync — the PDF reuses the exact same strings.

// ── Signal role ───────────────────────────────────────────────────────────────
export function signalRole(pct) {
  if (pct >= 35) return { text: 'главный сигнал',  cls: 'role-main' }
  if (pct >= 15) return { text: 'заметный вклад',  cls: 'role-notable' }
  if (pct >= 5)  return { text: 'влияет слабо',    cls: 'role-minor' }
  if (pct >  0)  return { text: 'почти не влияет', cls: 'role-tiny' }
  return               { text: 'дубль',            cls: 'role-dup' }
}

export function reliabilityNote(rel) {
  if (rel >= 0.7) return 'доверие высокое'
  if (rel >= 0.5) return 'доверие среднее'
  return 'ненадёжный признак'
}

export function buildSignalNote(pct, rel, isCollapsed) {
  if (isCollapsed) return 'уже учтён более сильный сигнал поблизости'
  const relNote = reliabilityNote(rel)
  if (pct >= 35) return `на нём держится бо́льшая часть оценки — ${relNote}`
  if (pct >= 15) return `заметный вклад в итоговую цифру — ${relNote}`
  if (pct >= 5)  return `влияет слабо — ${relNote}`
  return `${relNote}, почти не меняет итог`
}

// ── Confidence factor consequences ────────────────────────────────────────────
export function diversityConsequence(value, uniqueTypes) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return `${uniqueTypes} типа(ов) сигналов — хорошее разнообразие, оценке можно доверять`
  if (pct >= 35) return `${uniqueTypes} типа(ов) — неплохо, но больше видов следов повысит точность`
  return `всего ${uniqueTypes} тип(а) сигналов — мало разнообразия, добавьте больше видов наблюдений`
}

export function intensityConsequence(value) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return 'следы чёткие и выраженные — надёжная картина'
  if (pct >= 35) return 'следы умеренной силы'
  return 'следы слабые — возможно, всё почудилось'
}

export function consistencyConsequence(value) {
  const pct = Math.round(value * 100)
  if (pct >= 65) return 'следы в разных зонах в одно время — видно, что кроликов несколько, система увереннее'
  if (pct >= 35) return 'нет близких пар в разных зонах — нейтральная картина'
  return 'следы в разных зонах близко по времени — возможно, один кролик перебегает, уверенность ниже'
}

// ── Fallback recommendations (mirrors Recommendations.jsx logic) ───────────────
export function buildFallbackRecs(rabbits, confidence, events, byZone) {
  if (events.length === 0) {
    return ['Нет данных. Установите датчики и запишите первые наблюдения.']
  }

  const recs = []

  const topZone = Object.entries(byZone).sort((a, b) => b[1] - a[1])[0]
  if (topZone && topZone[1] > 0.5) {
    recs.push(`Зона «${topZone[0]}» — самая активная (~${topZone[1].toFixed(1)} кр.). Начните следующий обход отсюда.`)
  }

  if (events.some(e => e.event === 'motion_sensor')) {
    recs.push('Датчик движения сработал — осмотрите сарай, пока следы свежие.')
  }

  if (rabbits > 5) {
    recs.push(`Оценка крупная (~${Math.round(rabbits)} кр.). Установите датчики в зонах без сигналов — возможно, упускаем часть активности.`)
  }

  if (confidence < 50) {
    recs.push('Уверенность низкая. Добавьте сигналы из разных зон и разных типов — это повысит точность оценки.')
  }

  const fpZones = [...new Set(events.filter(e => e.event === 'footprints').map(e => e.location))]
  if (fpZones.length > 1) {
    recs.push(`Следы в нескольких зонах (${fpZones.join(', ')}) — проверьте переходы между участками.`)
  }

  if ((byZone['Теплица'] ?? 0) > 1) {
    recs.push('Теплица: повышенная активность. Осмотрите периметр — найдите, откуда заходят.')
  }

  const weakCount = events.filter(e => e.intensity <= 3).length
  if (weakCount > 0 && weakCount >= events.length / 2) {
    recs.push('Большинство следов слабые (заметность ≤3). Повторите наблюдение в тех же местах для подтверждения.')
  }

  return recs.slice(0, 4)
}
