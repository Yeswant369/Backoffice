"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

function SparkleIcon({ className }: { className?: string }) {
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
      <path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.8L12 16l-1.8-4.8L5.5 9.4l4.7-1.8L12 3z" />
      <path d="M19 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7L19 14z" />
    </svg>
  );
}

export default function AskAiButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Portal target only exists in the browser; render after mount to avoid
    // hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Outside-click dismiss */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60]"
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 right-6 z-[61] flex flex-col items-end">
        <AnimatePresence>
          {open && (
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ duration: 0.28, ease }}
              style={{ transformOrigin: "bottom right" }}
              className="mb-3 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5 shadow-2xl shadow-black/60"
            >
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d9d1c1] bg-[#efe9dd]">
                  <SparkleIcon className="h-4 w-4 text-neutral-900" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-neutral-900">Ask AI</p>
                  <p className="text-[11px] text-neutral-500">BOH assistant</p>
                </div>
              </div>

              <p className="text-sm text-neutral-700">Feature coming soon</p>
              <p className="mt-1 text-xs text-neutral-500">
                Soon you&apos;ll be able to ask questions about your inventory,
                vendors, and sales in plain language.
              </p>

              {/* Decorative disabled input hinting at the future experience */}
              <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3 py-2.5 opacity-60">
                <span className="text-sm text-neutral-500">Ask anything…</span>
                <SparkleIcon className="h-4 w-4 shrink-0 text-neutral-500" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={() => setOpen((v) => !v)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          aria-expanded={open}
          aria-label="Ask AI"
          className="flex items-center gap-2 rounded-full border border-[#d9d1c1] bg-[#efe9dd] px-4 py-3 text-sm font-medium text-neutral-900 shadow-lg shadow-black/10 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        >
          <SparkleIcon className="h-5 w-5" />
          <span>Ask AI</span>
        </motion.button>
      </div>
    </>,
    document.body,
  );
}
