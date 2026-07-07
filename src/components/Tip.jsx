import { useState, useRef, useEffect } from 'react'

// Click/tap-to-toggle tooltip. Uses position:fixed so it escapes overflow:hidden
// containers (table cells, scrollable divs). Closes on outside click/touch.
export default function Tip({ text }) {
  const [open, setOpen]   = useState(false)
  const [rect, setRect]   = useState(null)
  const ref               = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (!open && ref.current) setRect(ref.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    function close(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  const popupStyle = rect ? {
    position: 'fixed',
    top:  rect.top - 8,
    left: rect.left + rect.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex: 9999,
  } : {}

  return (
    <>
      <button
        ref={ref}
        className={'tip-btn' + (open ? ' tip-open' : '')}
        type="button"
        onClick={toggle}
        aria-label="Подсказка"
      >?</button>
      {open && rect && (
        <span className="tip-popup" style={popupStyle} role="tooltip">
          {text}
        </span>
      )}
    </>
  )
}
