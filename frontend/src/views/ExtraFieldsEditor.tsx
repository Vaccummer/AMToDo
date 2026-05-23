import { useState, useCallback, useRef } from "react"
import { useI18n } from "../i18n"

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

export function ExtraFieldsEditor({ fields, onChange }: Props) {
  const { t } = useI18n()
  const [entries, setEntries] = useState<FieldEntry[]>(() => toEntries(fields))
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragCounter = useRef(0)

  const sync = useCallback(
    (next: FieldEntry[]) => {
      setEntries(next)
      onChange(toRecord(next))
    },
    [onChange]
  )

  function handleAdd() {
    const next = [...entries, { key: "", value: "" }]
    sync(next)
  }

  function handleKeyChange(idx: number, val: string) {
    const next = entries.map((e, i) => (i === idx ? { ...e, key: val } : e))
    sync(next)
  }

  function handleValueChange(idx: number, val: string) {
    const next = entries.map((e, i) => (i === idx ? { ...e, value: val } : e))
    sync(next)
  }

  function handleDelete(idx: number) {
    const next = entries.filter((_, i) => i !== idx)
    sync(next)
  }

  /* ── Drag-and-drop ── */

  function handleDragStart(idx: number, e: React.DragEvent) {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(idx))
  }

  function handleDragOver(idx: number, e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setOverIdx(idx)
  }

  function handleDragLeave() {
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setOverIdx(null)
    }
  }

  function handleDragEnter(idx: number, e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current += 1
    setOverIdx(idx)
  }

  function handleDrop(idx: number, e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null)
      setOverIdx(null)
      return
    }
    const next = [...entries]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    sync(next)
    setDragIdx(null)
    setOverIdx(null)
  }

  function handleDragEnd() {
    dragCounter.current = 0
    setDragIdx(null)
    setOverIdx(null)
  }

  /* ── Render ── */

  const countText = entries.length > 0
    ? t("extraFields.count", { count: entries.length })
    : ""

  return (
    <div className="ef">
      <div className="ef-head">
        <div className="ef-head-l">
          <div className="ef-head-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/>
            </svg>
          </div>
          <div>
            <div className="ef-head-title">{t("extraFields.title")}</div>
            {countText && <div className="ef-head-count">{countText}</div>}
          </div>
        </div>
        <button type="button" className="ef-add" onClick={handleAdd}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("extraFields.addField")}
        </button>
      </div>

      {entries.length > 0 && (
        <div className="ef-list">
          {entries.map((entry, idx) => {
            const isDragging = dragIdx === idx
            const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx
            return (
              <div
                key={idx}
                className={`ef-card${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
                draggable
                onDragStart={(e) => handleDragStart(idx, e)}
                onDragOver={(e) => handleDragOver(idx, e)}
                onDragEnter={(e) => handleDragEnter(idx, e)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(idx, e)}
                onDragEnd={handleDragEnd}
              >
                <div className="ef-grip" title="Drag to reorder">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>
                <div className="ef-fields">
                  <div className="ef-f">
                    <input
                      type="text"
                      className="ef-k"
                      placeholder={t("extraFields.keyPlaceholder")}
                      value={entry.key}
                      onChange={(e) => handleKeyChange(idx, e.target.value)}
                    />
                  </div>
                  <div className="ef-f">
                    <input
                      type="text"
                      placeholder={t("extraFields.valuePlaceholder")}
                      value={entry.value}
                      onChange={(e) => handleValueChange(idx, e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="ef-del"
                  onClick={() => handleDelete(idx)}
                  title="Delete field"
                  aria-label="Delete field"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
