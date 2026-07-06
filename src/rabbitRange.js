// Converts an internal float estimate to a user-facing whole-animal range.
// Internal calculations stay floats; this is display-only.
export function rabbitRange(n) {
  const lo = Math.floor(n)
  const hi = Math.ceil(n)
  if (lo === hi) return String(lo)
  return `${lo}–${hi}`
}
