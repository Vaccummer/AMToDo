import { useCallback, useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n"

type FieldEntry = { key: string; value: string }

type Props = {
  fields: Record<string, string>
  onChange: (fields: Record<string, string>) => void
}

function toEntries(fields: Record<string, string>): FieldEntry[] {
  return Object.entries(fields).map(([key, value]) => ({ key, value }))
}

function toRecord(entries: FieldEntry[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of entries) {
    if (e.key.trim()) out[e.key.trim()] = e.value
  }
  return out
}

type TouchState = {
  idx: number
  startY: number
  startX: number
  startTime: number
  dragging: boolean
}

export function MobileExtraFieldsEditor({ fields, onChange }: Props) {
  const { t } = useI18n()

  const [entries, setEntries] = useState<FieldEntry[]>(() => toEntries(fields))
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editKey, setEditKey] = useState("")
  const [editValue, setEditValue] = useState("")

  const touchState = useRef<TouchState | null>(null)
  const chipRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fingerprintRef = useRef<string>("")
  const documentListenersRef = useRef<{ move: (e: TouchEvent) => void; end: (e: TouchEvent) => void } | null>(null)
  const pendingNewIdx = useRef<number | null>(null)

  /* ── Props sync ── */

  useEffect(() => {
    const fp = JSON.stringify(fields)
    if (fp !== fingerprintRef.current) {
      fingerprintRef.current = fp
      // Don't overwrite entries if the user is currently editing
      if (editIdx === null) {
        setEntries(toEntries(fields))
      }
    }
  }, [fields, editIdx])

  /* ── Core helpers ── */

  const sync = useCallback(
    (next: FieldEntry[]) => {
      setEntries(next)
      onChange(toRecord(next))
    },
    [onChange]
  )

  function openEdit(idx: number) {
    const entry = entries[idx]
    if (entry) {
      setEditIdx(idx)
      setEditKey(entry.key)
      setEditValue(entry.value)
    }
  }

  function confirmEdit() {
    if (editIdx === null) return
    const next = entries.map((e, i) =>
      i === editIdx ? { key: editKey, value: editValue } : e
    )
    pendingNewIdx.current = null
    sync(next)
    closeSheet()
  }

  function cancelEdit() {
    // If we were editing a newly added entry that was never confirmed, remove it
    if (pendingNewIdx.current !== null) {
      const idx = pendingNewIdx.current
      const next = entries.filter((_, i) => i !== idx)
      setEntries(next)
      onChange(toRecord(next))
    }
    pendingNewIdx.current = null
    closeSheet()
  }

  function closeSheet() {
    setEditIdx(null)
    setEditKey("")
    setEditValue("")
  }

  function handleDelete(idx: number) {
    const next = [...entries]
    next.splice(idx, 1)
    sync(next)
  }

  function handleAdd() {
    const next = [...entries, { key: "", value: "" }]
    setEntries(next)
    pendingNewIdx.current = entries.length
    setEditIdx(entries.length)
    setEditKey("")
    setEditValue("")
  }

  /* ── Long-press drag ── */

  function getSlotHeight(): number {
    const first = chipRefs.current.get(0)
    if (!first) return 60
    const rect = first.getBoundingClientRect()
    // slot = chip height + gap (6px from CSS)
    return rect.height + 6
  }

  function clearDragDOM() {
    chipRefs.current.forEach((el) => {
      el.style.transform = ""
      el.classList.remove("mef-dragging", "mef-drag-lifted")
      el.style.removeProperty("--mef-shift")
    })
    if (containerRef.current) {
      containerRef.current.style.touchAction = ""
    }
  }

  function commitReorder(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    const next = [...entries]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    sync(next)
  }

  const onGripTouchStart = useCallback(
    (idx: number) => (e: React.TouchEvent) => {
      const touch = e.touches[0]
      touchState.current = {
        idx,
        startY: touch.clientY,
        startX: touch.clientX,
        startTime: Date.now(),
        dragging: false,
      }

      longPressTimer.current = setTimeout(() => {
        const ts = touchState.current
        if (!ts || ts.idx !== idx) return

        ts.dragging = true
        const wrapper = chipRefs.current.get(idx)
        if (wrapper) {
          wrapper.classList.add("mef-dragging", "mef-drag-lifted")
        }
        if (containerRef.current) {
          containerRef.current.style.touchAction = "none"
        }
        navigator.vibrate?.(30)

        // Add document-level listeners
        const onMove = (ev: TouchEvent) => {
          const state = touchState.current
          if (!state) return
          const t = ev.touches[0]
          const deltaY = t.clientY - state.startY
          const deltaX = t.clientX - state.startX

          if (!state.dragging) {
            // Not yet in drag mode — check if moved too far (scroll)
            if (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10) {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current)
                longPressTimer.current = null
              }
              touchState.current = null
            }
            return
          }

          ev.preventDefault()

          // Move the dragged chip
          const wrapper = chipRefs.current.get(state.idx)
          if (wrapper) {
            wrapper.style.transform = `translateY(${deltaY}px)`
          }

          // Calculate target slot
          const slotHeight = getSlotHeight()
          const slots = Math.round(deltaY / slotHeight)
          const targetIdx = Math.max(0, Math.min(entries.length - 1, state.idx + slots))

          // Shift siblings
          chipRefs.current.forEach((el, i) => {
            if (i === state.idx) return
            if (state.idx < targetIdx) {
              // Dragging down: shift items between (idx, targetIdx] up
              if (i > state.idx && i <= targetIdx) {
                el.style.setProperty("--mef-shift", `${-slotHeight}px`)
              } else {
                el.style.removeProperty("--mef-shift")
              }
            } else if (state.idx > targetIdx) {
              // Dragging up: shift items between [targetIdx, idx) down
              if (i >= targetIdx && i < state.idx) {
                el.style.setProperty("--mef-shift", `${slotHeight}px`)
              } else {
                el.style.removeProperty("--mef-shift")
              }
            } else {
              el.style.removeProperty("--mef-shift")
            }
          })
        }

        const onEnd = (ev: TouchEvent) => {
          const state = touchState.current
          if (!state) return

          if (state.dragging) {
            ev.preventDefault()
            // Commit reorder
            const slotHeight = getSlotHeight()
            const endTouch = ev.changedTouches[0]
            const deltaY = endTouch.clientY - state.startY
            const slots = Math.round(deltaY / slotHeight)
            const targetIdx = Math.max(0, Math.min(entries.length - 1, state.idx + slots))

            clearDragDOM()
            commitReorder(state.idx, targetIdx)
          }
          // else: it was a short tap, handled by click on chip

          touchState.current = null
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
          }

          // Remove document listeners
          document.removeEventListener("touchmove", onMove)
          document.removeEventListener("touchend", onEnd)
          documentListenersRef.current = null
        }

        documentListenersRef.current = { move: onMove, end: onEnd }
        document.addEventListener("touchmove", onMove, { passive: false })
        document.addEventListener("touchend", onEnd, { passive: false })
      }, 300)
    },
    [entries, sync]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
      if (documentListenersRef.current) {
        document.removeEventListener("touchmove", documentListenersRef.current.move)
        document.removeEventListener("touchend", documentListenersRef.current.end)
      }
    }
  }, [])

  /* ── Chip click (short tap) ── */

  function handleChipClick(idx: number) {
    // Only open edit if we weren't dragging
    if (touchState.current?.dragging) return
    openEdit(idx)
  }

  /* ── Render ── */

  return (
    <div className="mef">
      <div className="mef-header">
        <div className="mef-header-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/>
          </svg>
          <span className="mef-header-title">{t("extraFields.title")}</span>
          {entries.length > 0 && (
            <span className="mef-header-count">{t("extraFields.count", { count: entries.length })}</span>
          )}
        </div>
        <button type="button" className="mef-add" onClick={handleAdd}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("extraFields.addField")}
        </button>
      </div>

      <div className="mef-chips" ref={containerRef}>
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className="mef-chip-wrapper"
            ref={(el) => {
              if (el) chipRefs.current.set(idx, el)
              else chipRefs.current.delete(idx)
            }}
          >
            <div
              className="mef-grip"
              onTouchStart={onGripTouchStart(idx)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" />
                <circle cx="15" cy="18" r="1.5" />
              </svg>
            </div>
            <div className="mef-chip" onClick={() => handleChipClick(idx)}>
              {entry.key ? <span className="mef-chip-key">{entry.key}</span> : null}
              {entry.key && entry.value ? <span className="mef-chip-divider">|</span> : null}
              {entry.value ? <span className="mef-chip-value">{entry.value}</span> : null}
              {!entry.key && !entry.value ? <span className="mef-chip-value" style={{ opacity: 0.4 }}>—</span> : null}
            </div>
            <button
              type="button"
              className="mef-chip-del"
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(idx)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="mef-empty">{t("extraFields.count", { count: 0 })}</div>
        )}
      </div>

      {editIdx !== null && (
        <>
          <div className="mef-overlay" onClick={cancelEdit} />
          <div className="mef-edit-panel">
            <div className="mef-edit-handle" />
            <div className="mef-edit-title">
              {editIdx < entries.length ? t("extraFields.editField") : t("extraFields.addField")}
            </div>
            <div className="mef-edit-fields">
              <input
                type="text"
                placeholder={t("extraFields.keyPlaceholder")}
                value={editKey}
                onInput={(e) => setEditKey((e.target as HTMLInputElement).value)}
              />
              <input
                type="text"
                placeholder={t("extraFields.valuePlaceholder")}
                value={editValue}
                onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="mef-edit-actions">
              <button type="button" className="mef-btn-cancel" onClick={cancelEdit}>
                {t("common.cancel")}
              </button>
              <button type="button" className="mef-btn-confirm" onClick={confirmEdit}>
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
