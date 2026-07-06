// Zone layout on the 440x310 SVG canvas
const ZONES = [
  { id: 'Огород',   emoji: '🥕', x: 14,  y: 14,  w: 188, h: 130 },
  { id: 'У забора', emoji: '🕳️', x: 228, y: 14,  w: 198, h: 130 },
  { id: 'Сарай',    emoji: '📡', x: 14,  y: 168, w: 188, h: 128 },
  { id: 'Теплица',  emoji: '🐾', x: 228, y: 168, w: 198, h: 128 },
]

// HSL interpolation: cool green → warm amber → hot red-orange
function heatColor(value, max) {
  if (max < 0.001) return 'hsl(120,28%,30%)'
  const t = Math.min(value / max, 1)
  const h = Math.round(118 - 98 * t)   // 118 → 20
  const s = Math.round(28  + 57 * t)   // 28  → 85
  const l = Math.round(30  + 14 * t)   // 30  → 44
  return `hsl(${h},${s}%,${l}%)`
}

export default function FarmMap({ byZone, events, activeZone, onZoneClick }) {
  const max = Math.max(...Object.values(byZone), 0.001)

  // Event count per zone for the badge
  const evtCount = {}
  for (const e of events) {
    evtCount[e.location] = (evtCount[e.location] ?? 0) + 1
  }

  return (
    <svg
      viewBox="0 0 440 310"
      className="farm-map-svg"
      role="img"
      aria-label="Карта фермы"
    >
      {/* Lawn background */}
      <rect width="440" height="310" rx="8" fill="#1e4d2b" />

      {/* Subtle grass texture */}
      {Array.from({ length: 22 }, (_, i) => (
        <line key={i}
          x1={0} y1={i * 14} x2={440} y2={i * 14}
          stroke="rgba(255,255,255,0.025)" strokeWidth="1"
        />
      ))}

      {/* Dirt paths between zones */}
      <rect x={206} y={0}   width={28} height={310} fill="#3a2810" opacity="0.55" />
      <rect x={0}   y={152} width={440} height={16} fill="#3a2810" opacity="0.55" />

      {/* Path texture dots */}
      {Array.from({ length: 14 }, (_, i) => (
        <circle key={i} cx={220} cy={10 + i * 22} r={2.5}
          fill="rgba(245,230,200,0.2)" />
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <circle key={i} cx={30 + i * 30} cy={160} r={2.5}
          fill="rgba(245,230,200,0.2)" />
      ))}

      {/* Zones */}
      {ZONES.map(z => {
        const est    = byZone[z.id] ?? 0
        const fill   = heatColor(est, max)
        const active = activeZone === z.id
        const count  = evtCount[z.id] ?? 0
        const cx     = z.x + z.w / 2
        const cy     = z.y + z.h / 2

        return (
          <g key={z.id} className="zone-g" onClick={() => onZoneClick(z.id)}>
            {/* Zone body */}
            <rect
              x={z.x} y={z.y} width={z.w} height={z.h} rx={6}
              fill={fill}
              stroke={active ? '#f5e6c8' : '#4a2a12'}
              strokeWidth={active ? 3 : 1.5}
              opacity={0.9}
            />

            {/* Active glow ring */}
            {active && (
              <rect
                x={z.x - 3} y={z.y - 3}
                width={z.w + 6} height={z.h + 6} rx={8}
                fill="none"
                stroke="rgba(245,230,200,0.5)"
                strokeWidth={2}
              />
            )}

            {/* Zone name */}
            <text
              x={cx} y={z.y + 22}
              textAnchor="middle"
              fontFamily="VT323, monospace" fontSize="15"
              fill="#f5e6c8" fontWeight="bold"
              style={{ textShadow: '1px 1px 0 rgba(0,0,0,0.8)', pointerEvents: 'none' }}
            >
              {z.id}
            </text>

            {/* Emoji sprite */}
            <text
              x={cx} y={cy + 10}
              textAnchor="middle"
              fontSize="30"
              style={{ pointerEvents: 'none' }}
            >
              {z.emoji}
            </text>

            {/* Rabbit estimate */}
            <text
              x={cx} y={z.y + z.h - 14}
              textAnchor="middle"
              fontFamily="VT323, monospace" fontSize="13"
              fill="rgba(245,230,200,0.9)"
              style={{ pointerEvents: 'none' }}
            >
              ~{est.toFixed(1)} 🐰
            </text>

            {/* Event count badge */}
            {count > 0 && (
              <g>
                <circle cx={z.x + z.w - 14} cy={z.y + 14} r={11} fill="#e8a020" />
                <circle cx={z.x + z.w - 14} cy={z.y + 14} r={11}
                  fill="none" stroke="#5c3319" strokeWidth="1.5" />
                <text
                  x={z.x + z.w - 14} y={z.y + 19}
                  textAnchor="middle"
                  fontFamily="VT323, monospace" fontSize="13"
                  fill="#3d1f00" fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {count}
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* Bottom hint */}
      <text
        x={220} y={302}
        textAnchor="middle"
        fontFamily="VT323, monospace" fontSize="11"
        fill="rgba(160,192,128,0.7)"
      >
        нажмите на зону для подробностей
      </text>
    </svg>
  )
}
