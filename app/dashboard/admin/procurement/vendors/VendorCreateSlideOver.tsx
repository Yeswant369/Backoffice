"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { triggerSheetSync } from "@/lib/sheet-sync-client";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "@/app/dashboard/_components/forms";
import { createVendor } from "../actions";

const ease = [0.22, 1, 0.36, 1] as const;

interface VendorCategory {
  id: string;
  name: string;
}

export default function VendorCreateSlideOver({
  vendorCategories,
}: {
  vendorCategories: VendorCategory[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  function openPanel() {
    setFeedback(null);
    setCreated(false);
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setFeedback(null);
    setPending(true);

    const res = await createVendor(undefined, new FormData(form));
    if (res.error) {
      setFeedback({ type: "error", message: res.error });
      setPending(false);
      return;
    }

    // Vendor is now in the DB — reflect it and prevent a duplicate submit.
    setCreated(true);
    const sync = await triggerSheetSync();
    setPending(false);
    router.refresh();

    if (sync.ok) {
      setOpen(false);
    } else {
      setFeedback({
        type: "error",
        message: `Vendor created — but Sheet sync failed: ${sync.error}. Share the connected sheet (Settings) with the service account as Editor, then it will sync.`,
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        Create Vendor
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/60"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.32, ease }}
              className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col border-l border-[#e6e0d3] bg-white/95"
            >
              <div className="flex items-center justify-between border-b border-[#e6e0d3] px-6 py-5">
                <h2 className="text-base font-semibold text-neutral-900">New Vendor</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-[#e6e0d3] px-2.5 py-1 text-sm text-neutral-600 transition hover:text-neutral-900"
                >
                  Close
                </button>
              </div>

              <form
                onSubmit={onSubmit}
                className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Identity
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Vendor code" hint="leave blank to auto-number">
                    <input
                      name="vendor_code"
                      placeholder="auto — e.g. TRM FOD01"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Name">
                    <input name="name" required placeholder="Fresh Farms" className={inputCls} />
                  </Field>
                  <Field label="Nature of supply" hint="Optional">
                    <input name="nature_of_supply" placeholder="Vegetables" className={inputCls} />
                  </Field>
                  <Field label="Category" hint="Optional">
                    <select name="category_id" defaultValue="" className={inputCls}>
                      <option value="">— None —</option>
                      {vendorCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Contact person" hint="Optional">
                    <input name="contact_person" className={inputCls} />
                  </Field>
                  <Field label="Phone" hint="Optional">
                    <input name="phone" className={inputCls} />
                  </Field>
                  <Field label="Alt phone" hint="Optional">
                    <input name="alt_phone" className={inputCls} />
                  </Field>
                  <Field label="Email" hint="Optional">
                    <input name="email" type="email" className={inputCls} />
                  </Field>
                  <Field label="Status">
                    <select name="status" defaultValue="ACTIVE" className={inputCls}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="BLACKLISTED">Blacklisted</option>
                    </select>
                  </Field>
                </div>

                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Bank details
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Bank name" hint="Optional">
                    <input name="bank_name" className={inputCls} />
                  </Field>
                  <Field label="Account number" hint="Optional">
                    <input name="account_number" className={inputCls} />
                  </Field>
                  <Field label="IFSC code" hint="Optional">
                    <input name="ifsc_code" className={inputCls} />
                  </Field>
                  <Field label="UPI ID" hint="Optional">
                    <input name="upi_id" className={inputCls} />
                  </Field>
                  <Field label="Payment terms" hint="e.g. Net 15">
                    <input name="payment_terms" className={inputCls} />
                  </Field>
                </div>

                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Address &amp; notes
                </p>
                <div className="space-y-4">
                  <Field label="Address" hint="Optional">
                    <textarea name="address" rows={2} className={inputCls} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="GSTIN" hint="Optional">
                      <input name="gstin" className={inputCls} />
                    </Field>
                    <Field label="Dormancy note" hint="Optional">
                      <input name="dormancy_note" className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Notes" hint="Optional">
                    <textarea name="notes" rows={2} className={inputCls} />
                  </Field>
                </div>

                <FormFeedback feedback={feedback} />
                {created ? (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="w-full rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-[#efe9dd]"
                  >
                    Done
                  </button>
                ) : (
                  <SubmitButton pending={pending} pendingLabel="Creating…">
                    Create vendor &amp; sync
                  </SubmitButton>
                )}
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
