"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ADMIN_NAV,
  ROLES,
  STANDALONE_NAV,
  accessibleSections,
  type RoleId,
} from "@/lib/roles";
import type { SearchGroup, SearchHit } from "../search/search";

const ease = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/* Page index — role-aware navigation entries, matched instantly       */
/* ------------------------------------------------------------------ */

interface PageEntry {
  label: string;
  href: string;
  group: string;
  /** Synonyms/aliases so "gst", "supplier", "food cost"… still hit. Lowercase. */
  keywords: string;
  icon?: string;
}

/** Aliases keyed by href — what a restaurant operator might actually type. */
const PAGE_KEYWORDS: Record<string, string> = {
  "/dashboard/admin": "home financial overview revenue dashboard summary",
  "/dashboard/admin/analytics/variance": "variance shrinkage theft loss analysis",
  "/dashboard/admin/departments": "department pnl p&l profit loss create department",
  "/dashboard/admin/departments/daily": "daily costing food cost consumption closing",
  "/dashboard/admin/analytics/menu-engineering": "menu engineering stars dogs popularity margin",
  "/dashboard/admin/analytics/profit": "cost profit margin recipe costing",
  "/dashboard/admin/analytics/pos": "pos sales petpooja gst channel swiggy zomato daypart",
  "/dashboard/admin/anomalies": "anomalies alerts warnings unusual",
  "/dashboard/admin/procurement/purchase-log": "procure to pay purchases bills invoices history",
  "/dashboard/admin/procurement/reorder": "reorder par level low stock replenish",
  "/dashboard/admin/procurement/orders": "purchase order po indent approve dispatch receive request",
  "/dashboard/admin/inventory/issue-stock": "issue stock transfer inventory control department",
  "/dashboard/admin/inventory/live-stock": "live stock on hand value levels",
  "/dashboard/admin/inventory/count": "stock count physical counting closing audit",
  "/dashboard/admin/kitchen-production": "kitchen production worksheet sub recipe batch wastage new department",
  "/dashboard/admin/wastage": "record wastage waste spoilage damage",
  "/dashboard/admin/sales": "record sale manual sales entry",
  "/dashboard/admin/reconciliation": "daily reconciliation cash deposit variance",
  "/dashboard/admin/petty-cash": "petty cash expenses spend",
  "/dashboard/admin/dues": "dues credit outstanding owed tracker",
  "/dashboard/admin/procurement/payments": "vendor payments paid payment history",
  "/dashboard/admin/accounting": "accounting export tally csv books",
  "/dashboard/admin/catalog?tab=materials": "raw materials catalog ingredients operational items sku",
  "/dashboard/admin/catalog?tab=recipes": "recipe builder dishes cuisine sub recipe menu items",
  "/dashboard/admin/procurement/vendors": "vendor directory suppliers vendor codes",
  "/dashboard/admin/settings": "settings google sheets sync petpooja pos api keys configuration",
  "/dashboard/admin/staff": "manage staff invite team members users roles set password link",
  "/dashboard/analytics": "analytics cash flow revenue trends",
  "/dashboard/portfolio": "portfolio outlets cross outlet rollup locations",
  "/dashboard/manager": "management vendor dues reconciliation petty cash",
  "/dashboard/store": "store inventory live stock purchases transfers",
  "/dashboard/kitchen": "kitchen issues recipes wastage production",
};

function buildPageIndex(roles: RoleId[]): PageEntry[] {
  const entries: PageEntry[] = [];

  if (roles.includes(ROLES.ADMIN)) {
    for (const group of ADMIN_NAV) {
      for (const item of group.items) {
        entries.push({
          label: item.label,
          href: item.href,
          group: group.title,
          keywords: (PAGE_KEYWORDS[item.href] ?? "").toLowerCase(),
          icon: item.icon,
        });
      }
    }
  }

  // Role sections (Manager / Store / Kitchen / Portfolio) the user can enter —
  // the admin console is already covered above in full detail.
  for (const s of accessibleSections(roles)) {
    if (s.key === "admin" && roles.includes(ROLES.ADMIN)) continue;
    entries.push({
      label: s.label,
      href: s.href,
      group: "Workspaces",
      keywords: `${s.description} ${PAGE_KEYWORDS[s.href] ?? ""}`.toLowerCase(),
    });
  }
  for (const item of STANDALONE_NAV) {
    entries.push({
      label: item.label,
      href: item.href,
      group: "Workspaces",
      keywords: `${item.description} ${PAGE_KEYWORDS[item.href] ?? ""}`.toLowerCase(),
      icon: item.icon,
    });
  }
  return entries;
}

/** Simple ranked match: label prefix > label substring > word prefix > alias. */
function scorePage(entry: PageEntry, q: string): number {
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 80;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 70;
  if (entry.keywords.includes(q)) return 50;
  // every query word must hit label or aliases (multi-word queries)
  const words = q.split(/\s+/).filter(Boolean);
  if (
    words.length > 1 &&
    words.every((w) => label.includes(w) || entry.keywords.includes(w))
  )
    return 40;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Icons                                                                */
/* ------------------------------------------------------------------ */

const GROUP_ICONS: Record<string, string> = {
  Vendors: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z",
  Materials:
    "M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  Recipes: "M8 3v7a3 3 0 003 3v8m2-18a3 3 0 013 3v4a3 3 0 01-3 3",
  "Orders & Indents":
    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  "Purchase Bills": "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18",
  Departments: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  Categories:
    "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01",
  Staff:
    "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8z",
};

function StrokeIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {d.split("|").map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon d="M11 19a8 8 0 100-16 8 8 0 000 16z|M21 21l-4.3-4.3" className={className} />
  );
}

/** Bold the first case-insensitive occurrence of the query in `text`. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-indigo-700">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */

interface FlatItem {
  key: string;
  title: string;
  subtitle: string;
  href: string;
  group: string;
  icon?: string;
  isPage: boolean;
}

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export default function CommandPalette({ roles }: { roles: RoleId[] }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entityGroups, setEntityGroups] = useState<SearchGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  /** True from keystroke until the matching response lands — covers the
   *  debounce window, so we never show a definitive "No matches" early. */
  const [searching, setSearching] = useState(false);
  const pageIndex = useMemo(() => buildPageIndex(roles), [roles]);
  // Entity search hits admin-only routes; the server re-checks authoritatively.
  const canSearchEntities = roles.includes(ROLES.ADMIN);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    // Portal target only exists in the browser; render after mount to avoid
    // hydration mismatch (same pattern as AskAiButton).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  /** Stop every pending/in-flight search and invalidate late responses. */
  const cancelSearch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    seqRef.current += 1;
  }, []);

  const openPalette = useCallback(() => {
    cancelSearch();
    setQuery("");
    setEntityGroups([]);
    setActiveIndex(0);
    setSearching(false);
    setOpen(true);
  }, [cancelSearch]);

  const close = useCallback(() => {
    cancelSearch();
    setOpen(false);
    setQuery("");
    setEntityGroups([]);
    setActiveIndex(0);
    setSearching(false);
  }, [cancelSearch]);

  // Cancel pending work when the palette unmounts (route away from /dashboard).
  useEffect(() => cancelSearch, [cancelSearch]);

  // Global shortcuts: ⌘K / Ctrl+K toggles; "/" opens (outside form fields);
  // Escape closes wherever focus sits (the input handles it too, for order).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else openPalette();
        return;
      }
      if (open) {
        if (e.key === "Escape") close();
        return; // "/" while open is just typing/no-op — never wipe the query
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable)
          return;
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, openPalette]);

  // Focus once when the input mounts — stable identity, so it does NOT re-run
  // on later commits (a fresh inline callback would steal focus every render).
  const focusOnMount = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setActiveIndex(0);
    cancelSearch();
    const q = value.trim();
    if (!canSearchEntities || q.length < 2) {
      setEntityGroups([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = seqRef.current;
    timerRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      fetch(`/dashboard/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ groups: SearchGroup[] }>) : { groups: [] }))
        .then((res) => {
          if (seqRef.current !== seq) return; // stale — a newer search owns the UI
          setEntityGroups(res.groups ?? []);
          setSearching(false);
        })
        .catch(() => {
          if (seqRef.current === seq) setSearching(false); // abort/network
        });
    }, 180);
  };

  /* ------- Result list (computed in render — no effects needed) ------- */
  const q = query.trim().toLowerCase();

  let pageHits: PageEntry[];
  if (!q) {
    pageHits = pageIndex; // browsing mode: the full app directory
  } else {
    pageHits = pageIndex
      .map((p) => ({ p, s: scorePage(p, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 7)
      .map((x) => x.p);
  }

  const flat: FlatItem[] = [];
  const sections: { label: string; items: FlatItem[] }[] = [];

  if (!q) {
    // Directory view — group pages by their nav group.
    const byGroup = new Map<string, FlatItem[]>();
    for (const p of pageHits) {
      const item: FlatItem = {
        key: `page:${p.href}`,
        title: p.label,
        subtitle: "",
        href: p.href,
        group: p.group,
        icon: p.icon,
        isPage: true,
      };
      const list = byGroup.get(p.group) ?? [];
      list.push(item);
      byGroup.set(p.group, list);
    }
    for (const [label, items] of byGroup) sections.push({ label, items });
  } else {
    if (pageHits.length > 0) {
      sections.push({
        label: "Pages",
        items: pageHits.map((p) => ({
          key: `page:${p.href}`,
          title: p.label,
          subtitle: p.group,
          href: p.href,
          group: p.group,
          icon: p.icon,
          isPage: true,
        })),
      });
    }
    for (const g of entityGroups) {
      sections.push({
        label: g.label,
        items: g.hits.map((h: SearchHit) => ({
          key: `${g.label}:${h.id}`,
          title: h.title,
          subtitle: h.subtitle,
          href: h.href,
          group: g.label,
          icon: GROUP_ICONS[g.label],
          isPage: false,
        })),
      });
    }
  }
  for (const s of sections) flat.push(...s.items);

  // Clamp instead of resetting in an effect when the list shrinks.
  const active = flat.length === 0 ? -1 : Math.min(activeIndex, flat.length - 1);

  const navigate = useCallback(
    (item: FlatItem) => {
      close();
      router.push(item.href);
    },
    [close, router],
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(active < 0 ? 0 : Math.min(active + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max((active < 0 ? 0 : active) - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && flat[active]) navigate(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  if (!mounted) return null;

  const placeholder = canSearchEntities
    ? "Search pages, vendors, materials, recipes, orders, staff…"
    : "Search pages…";

  let flatPos = -1; // running index across sections for active-row math

  return createPortal(
    <>
      {/* Trigger — fixed top-right */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search everything"
        className="fixed right-6 top-5 z-40 flex items-center gap-2 rounded-full border border-[#d9d1c1] bg-[#f7f3ec]/90 py-2 pl-3.5 pr-2.5 text-sm text-neutral-600 shadow-sm backdrop-blur transition hover:border-[#c9bfa9] hover:bg-white hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
      >
        <SearchIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded-md border border-[#d9d1c1] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 sm:inline">
          {isMac() ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[2px]"
            onMouseDown={close}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Universal search"
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease }}
              onMouseDown={(e) => e.stopPropagation()}
              className="mx-auto mt-[12vh] w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[#e6e0d3] bg-[#f7f3ec] shadow-2xl shadow-black/25"
            >
              {/* Input row */}
              <div className="flex items-center gap-3 border-b border-[#e6e0d3] px-4 py-3.5">
                <SearchIcon
                  className={`h-5 w-5 shrink-0 ${searching ? "animate-pulse text-indigo-600" : "text-neutral-500"}`}
                />
                <input
                  ref={focusOnMount}
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder={placeholder}
                  aria-label="Search"
                  role="combobox"
                  aria-expanded={flat.length > 0}
                  aria-controls="command-palette-results"
                  className="w-full bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border border-[#d9d1c1] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 transition hover:text-neutral-800"
                >
                  esc
                </button>
              </div>

              {/* Results */}
              <div
                id="command-palette-results"
                role="listbox"
                aria-label="Search results"
                className="max-h-[55vh] overflow-y-auto overscroll-contain p-2"
              >
                {flat.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    {searching ? (
                      <p className="text-sm text-neutral-500">Searching…</p>
                    ) : (
                      <>
                        <p className="text-sm text-neutral-600">
                          No matches for <span className="font-semibold">“{query}”</span>
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {canSearchEntities
                            ? "Try a vendor, material, recipe, PO number, bill number, category or staff name."
                            : "Try a page name — e.g. Live Stock or Analytics."}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  sections.map((section) => (
                    <div key={section.label} className="mb-1">
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        {section.label}
                      </p>
                      {section.items.map((item) => {
                        flatPos += 1;
                        const idx = flatPos;
                        const isActive = idx === active;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            // keep the active row visible during keyboard nav
                            ref={(el) => {
                              if (isActive) el?.scrollIntoView({ block: "nearest" });
                            }}
                            onMouseMove={() => {
                              if (activeIndex !== idx) setActiveIndex(idx);
                            }}
                            // navigate() touches refs only inside the click
                            // handler (via close/cancelSearch), never in render.
                            // eslint-disable-next-line react-hooks/refs
                            onClick={() => navigate(item)}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                              isActive ? "bg-[#efe9dd]" : "hover:bg-[#efe9dd]/60"
                            }`}
                          >
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                                isActive
                                  ? "border-[#c9bfa9] bg-white text-neutral-900"
                                  : "border-[#e6e0d3] bg-[#efe9dd] text-neutral-600"
                              }`}
                            >
                              {item.icon ? (
                                <StrokeIcon d={item.icon} className="h-4 w-4" />
                              ) : (
                                <SearchIcon className="h-4 w-4" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-neutral-900">
                                <Highlight text={item.title} q={query.trim()} />
                              </span>
                              {item.subtitle && (
                                <span className="block truncate text-xs text-neutral-500">
                                  {item.subtitle}
                                </span>
                              )}
                            </span>
                            {isActive && (
                              <kbd className="shrink-0 rounded-md border border-[#d9d1c1] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                                ↵
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer hints */}
              <div className="flex items-center justify-between border-t border-[#e6e0d3] px-4 py-2.5 text-[11px] text-neutral-500">
                <span className="flex items-center gap-3">
                  <span>
                    <kbd className="rounded border border-[#d9d1c1] bg-white px-1 font-semibold">↑↓</kbd>{" "}
                    navigate
                  </span>
                  <span>
                    <kbd className="rounded border border-[#d9d1c1] bg-white px-1 font-semibold">↵</kbd>{" "}
                    open
                  </span>
                  <span>
                    <kbd className="rounded border border-[#d9d1c1] bg-white px-1 font-semibold">esc</kbd>{" "}
                    close
                  </span>
                </span>
                <span>Searches your outlet&apos;s data</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
