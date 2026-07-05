"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboOption {
  id: string;
  label: string;
  /** Secondary text (code, unit, price…) — searched too, shown dimmed. */
  hint?: string;
}

/**
 * Typed auto-suggest picker (combobox) — the app-wide replacement for plain
 * <select> entity pickers. Type to filter by label OR hint (e.g. material code),
 * arrow keys + Enter to choose, Esc to close. Form-compatible: the chosen id is
 * submitted through a hidden <input name=…>, so server actions reading FormData
 * are unchanged. Optionally controlled via value/onChange.
 */
export default function Combobox({
  name,
  options,
  placeholder = "Type to search…",
  required = false,
  value,
  onChange,
  defaultValue = "",
  id,
}: {
  name: string;
  options: ComboOption[];
  placeholder?: string;
  required?: boolean;
  /** Controlled selected id (optional). */
  value?: string;
  onChange?: (id: string) => void;
  /** Uncontrolled initial selected id. */
  defaultValue?: string;
  id?: string;
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const rawSelectedId = controlled ? value : internal;

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const selected = rawSelectedId ? byId.get(rawSelectedId) : undefined;
  // An id that isn't one of the offered options (foreign outlet, deleted row,
  // stale deep-link) must behave as NO selection: nothing displays, nothing
  // submits, and `required` re-engages — never submit an invisible value.
  const selectedId = selected ? rawSelectedId : "";

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  // Display text: the selection's label unless the user is mid-search.
  const display = open ? query : (selected?.label ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.hint ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [options, query]);

  function choose(o: ComboOption) {
    if (!controlled) setInternal(o.id);
    onChange?.(o.id);
    setOpen(false);
    setQuery("");
  }

  function clear() {
    if (!controlled) setInternal("");
    onChange?.("");
    setQuery("");
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the active row visible while arrowing.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const inputCls =
    "w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25";

  return (
    <div ref={rootRef} className="relative">
      {/* The value the form actually submits. */}
      <input type="hidden" name={name} value={selectedId ?? ""} />
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={display}
          placeholder={placeholder}
          required={required && !selectedId}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (open && filtered[active]) {
                e.preventDefault();
                choose(filtered[active]);
              } else if (open) {
                // No match — close and drop the query so the display falls
                // back to "" and `required` blocks a text-only submit.
                e.preventDefault();
                setOpen(false);
                setQuery("");
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          className={`${inputCls} pr-8`}
        />
        {selected && !open ? (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 transition hover:text-neutral-700"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4">
              <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
          >
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[#e6e0d3] bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-500">No matches.</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === selectedId}
                data-active={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // beat the input blur
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${
                  i === active ? "bg-indigo-50 text-indigo-900" : "text-neutral-800"
                }`}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && (
                  <span className="shrink-0 font-mono text-[11px] text-neutral-400">
                    {o.hint}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
