import { EVENT_META } from './data.js'

// Threshold below which a signal's reliability is considered "weak" in the explanation
const WEAK_RELIABILITY_THRESHOLD = 0.4

// Builds a plain-language sentence explaining the current estimate.
//
// Architecture note: Phase 3 will call POST /api/advise and use the LLM's
// response as `explanation` instead. This function is the fallback when the
// API is unavailable or hasn't responded yet. Keep the signature stable so
// the caller (App.jsx) can swap the source without restructuring.
//
// Returns a string (never null), always in Russian.
export function buildFallbackExplanation(rabbits, contributions, events, params) {
  if (events.length === 0) {
    return 'Нет данных — добавьте первые наблюдения.'
  }

  const evtMap = Object.fromEntries(events.map(e => [e.id, e]))

  const active = contributions
    .filter(c => c.percent > 0)
    .sort((a, b) => b.percent - a.percent)

  if (active.length === 0) {
    return 'Все сигналы перекрыли друг друга — добавьте наблюдения в разных зонах.'
  }

  // Top 1-2 contributors phrased as "X в Зоне"
  const topPhrases = active.slice(0, 2).map(c => {
    const e = evtMap[c.id]
    if (!e) return null
    const meta = EVENT_META[e.event]
    return meta ? `${meta.label.toLowerCase()} в ${e.location.toLowerCase()}` : null
  }).filter(Boolean)

  // Unique signal types that have low reliability (farmer reads them as untrustworthy)
  const weakTypes = new Set(
    active
      .filter(c => {
        const e = evtMap[c.id]
        return e && (params.reliability[e.event] ?? 1) < WEAK_RELIABILITY_THRESHOLD
      })
      .map(c => evtMap[c.id]?.event)
      .filter(Boolean)
  )
  const weakLabels = [...weakTypes]
    .slice(0, 2)
    .map(t => EVENT_META[t]?.label?.toLowerCase())
    .filter(Boolean)

  let text = topPhrases.length > 0
    ? `Больше всего указывают ${topPhrases.join(' и ')}.`
    : `Оценка основана на ${active.length} сигналах.`

  if (weakLabels.length > 0) {
    const names = weakLabels.join(' и ')
    const cap = names.charAt(0).toUpperCase() + names.slice(1)
    text += ` ${cap} почти не учитываем — ненадёжный признак.`
  }

  return text
}
