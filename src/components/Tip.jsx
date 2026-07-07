import { useState, useRef, useEffect } from 'react'

// Click/tap-to-toggle tooltip. Uses position:fixed so it escapes overflow:hidden
// containers. Position is computed fresh on every scroll event (capture phase,
// passive) via direct DOM mutation — no React re-render, no drift.
export default function Tip({ text }) {
  const [open,    setOpen]    = useState(false)
  const triggerRef            = useRef(null)
  const popupRef              = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    setOpen(o => !o)
  }

  // Compute fixed position from the trigger's current bounding rect.
  function popupStyle() {
    if (!triggerRef.current) return { position: 'fixed', top: -9999, left: -9999 }
    const r = triggerRef.current.getBoundingClientRect()
    return {
      position:  'fixed',
      top:       r.top - 8,
      left:      r.left + r.width / 2,
      transform: 'translate(-50%, -100%)',
      zIndex:    9999,
    }
  }

  useEffect(() => {
    if (!open) return

    // Update popup position directly on DOM node — skip React state to avoid
    // re-render overhead and eliminate the one-frame lag that causes drift.
    function reposition() {
      if (!popupRef.current || !triggerRef.current) return
      const r = triggerRef.current.getBoundingClientRect()
      popupRef.current.style.top  = (r.top - 8) + 'px'
      popupRef.current.style.left = (r.left + r.width / 2) + 'px'
    }

    function close(e) {
      if (triggerRef.current && !triggerRef.current.contains(e.target)) setOpen(false)
    }

    // Capture phase catches scroll on every ancestor container (overflow:auto panels).
    window.addEventListener('scroll',  reposition, { capture: true, passive: true })
    window.addEventListener('resize',  reposition, { passive: true })
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      window.removeEventListener('scroll',  reposition, { capture: true })
      window.removeEventListener('resize',  reposition)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className={'tip-btn' + (open ? ' tip-open' : '')}
        type="button"
        onClick={toggle}
        aria-label="Подсказка"
      >?</button>
      {open && (
        <span ref={popupRef} className="tip-popup" style={popupStyle()} role="tooltip">
          {text}
        </span>
      )}
    </>
  )
}
