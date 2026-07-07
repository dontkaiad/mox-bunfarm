import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

function findNext(options, from, dir) {
  let i = from + dir
  while (i >= 0 && i < options.length) {
    if (!options[i].divider && !options[i].disabled) return i
    i += dir
  }
  return from
}

// Portals the list to <body> so overflow:hidden/auto parents don't clip it.
export default function Dropdown({ options, value, onChange, placeholder = '…', className = '' }) {
  const [open,      setOpen]      = useState(false)
  const [focused,   setFocused]   = useState(-1)
  const [listStyle, setListStyle] = useState({})
  const rootRef    = useRef()
  const triggerRef = useRef()
  const listRef    = useRef()

  const computeStyle = useCallback(() => {
    if (!triggerRef.current) return {}
    const r = triggerRef.current.getBoundingClientRect()
    return { top: r.bottom, left: r.left, width: r.width }
  }, [])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (!rootRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function reposition() { setListStyle(computeStyle()) }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, computeStyle])

  useEffect(() => {
    if (!open || focused < 0) return
    listRef.current?.querySelector(`[data-idx="${focused}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, focused])

  const selected = options.find(o => !o.divider && o.value === value)

  function openList() {
    setListStyle(computeStyle())
    const idx = options.findIndex(o => !o.divider && !o.disabled && o.value === value)
    setFocused(idx >= 0 ? idx : findNext(options, -1, 1))
    setOpen(true)
  }

  function closeList() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function pick(opt) {
    if (opt.divider || opt.disabled) return
    onChange(opt.value)
    closeList()
  }

  function onTriggerKey(e) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList() }
      return
    }
    switch (e.key) {
      case 'Escape':    e.preventDefault(); closeList(); break
      case 'ArrowDown': e.preventDefault(); setFocused(f => findNext(options, f,  1)); break
      case 'ArrowUp':   e.preventDefault(); setFocused(f => findNext(options, f, -1)); break
      case 'Enter':
      case ' ':         e.preventDefault(); if (focused >= 0) pick(options[focused]); break
      case 'Tab':       closeList(); break
    }
  }

  const list = (
    <ul
      className="dropdown-list"
      role="listbox"
      ref={listRef}
      style={{
        position: 'fixed',
        top:   listStyle.top,
        left:  listStyle.left,
        width: listStyle.width,
        zIndex: 9999,
      }}
    >
      {options.map((opt, i) =>
        opt.divider
          ? <li key={i} className="dropdown-separator" role="separator" />
          : (
            <li
              key={opt.value ?? i}
              data-idx={i}
              role="option"
              aria-selected={opt.value === value}
              className={[
                'dropdown-item',
                opt.value === value ? 'selected'  : '',
                i === focused        ? 'focused'   : '',
                opt.disabled         ? 'disabled'  : '',
              ].filter(Boolean).join(' ')}
              onMouseDown={e => { e.preventDefault(); pick(opt) }}
              onMouseEnter={() => !opt.disabled && setFocused(i)}
            >
              {opt.emoji && <span className="dd-emoji">{opt.emoji}</span>}
              <span>{opt.label}</span>
            </li>
          )
      )}
    </ul>
  )

  return (
    <div className={`custom-dropdown${className ? ' ' + className : ''}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`dropdown-trigger${open ? ' open' : ''}`}
        onClick={() => open ? closeList() : openList()}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-selected">
          {selected
            ? <>
                {selected.emoji && <span className="dd-emoji">{selected.emoji}</span>}
                <span>{selected.label}</span>
              </>
            : <span className="dd-placeholder">{placeholder}</span>
          }
        </span>
        <span className="dropdown-arrow" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && createPortal(list, document.body)}
    </div>
  )
}
