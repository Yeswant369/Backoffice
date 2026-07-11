"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inr } from "@/lib/format";
import {
  Field,
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../../../_components/forms";
import {
  reviewPurchaseOrder,
  dispatchIndent,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  type PoState,
} from "../../po-actions";

export interface PanelOrder {
  id: string;
  po_number: string;
  kind: "VENDOR" | "INDENT";
  status: string;
}

export interface PanelLine {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  requested_qty: number;
  approved_qty: number | null;
  fulfilled_qty: number;
  expected_unit_price: number | null;
}

const fb = (s: PoState | undefined): Feedback | null =>
  s?.error
    ? { type: "error", message: s.error }
    : s?.success
      ? { type: "success", message: s.success }
      : null;

const cardCls = "space-y-4 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5";

const TERMINAL_BANNERS: Record<string, { cls: string; text: string }> = {
  DISPATCHED: {
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    text: "This indent has been dispatched — stock already moved to the department.",
  },
  RECEIVED: {
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    text: "This order has been received — stock and last-purchase prices are updated.",
  },
  REJECTED: {
    cls: "border-red-200 bg-red-50 text-red-600",
    text: "This request was rejected. Raise a new one if it is still needed.",
  },
  CANCELLED: {
    cls: "border-[#e6e0d3] bg-[#efe9dd] text-neutral-600",
    text: "This request was cancelled. Raise a new one if it is still needed.",
  },
};

/**
 * Status-driven action panel for one order: approve/reject/cancel while
 * PENDING, dispatch (indent) or receive-with-bill (vendor) once APPROVED,
 * and a read-only banner for terminal states.
 */
export default function ReviewPanel({
  order,
  lines,
  locationId,
  canReview,
}: {
  order: PanelOrder;
  lines: PanelLine[];
  locationId: string;
  /** Admin/Manager only — gates the PENDING approve/reject section. */
  canReview: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(),
      ),
    [],
  );

  // PENDING → approve (with per-line adjusted quantities gathered client-side).
  const [approveState, approveAction, approvePending] = useActionState<
    PoState | undefined,
    FormData
  >(async (prev, fd) => {
    const adjustments: Record<string, number> = {};
    for (const l of lines) {
      adjustments[l.id] = Number(fd.get(`qty_${l.id}`) ?? 0);
    }
    fd.set("adjustments", JSON.stringify(adjustments));
    return reviewPurchaseOrder(prev, fd);
  }, undefined);

  const [rejectState, rejectAction, rejectPending] = useActionState<
    PoState | undefined,
    FormData
  >(reviewPurchaseOrder, undefined);

  const [cancelState, cancelAction, cancelPending] = useActionState<
    PoState | undefined,
    FormData
  >(cancelPurchaseOrder, undefined);

  // APPROVED indent → dispatch the Store→department transfer.
  const [dispatchState, dispatchAction, dispatchPending] = useActionState<
    PoState | undefined,
    FormData
  >(async (prev, fd) => {
    const out = lines
      .map((l) => ({ line_id: l.id, qty: Number(fd.get(`qty_${l.id}`) ?? 0) }))
      .filter((l) => l.qty > 0);
    if (out.length === 0) return { error: "Enter at least one dispatch quantity." };
    fd.set("lines", JSON.stringify(out));
    return dispatchIndent(prev, fd);
  }, undefined);

  // APPROVED vendor PO → upload bill photos to storage FIRST (browser client,
  // per-outlet folder), then one server action records the bill atomically.
  const [receiveState, receiveAction, receivePending] = useActionState<
    PoState | undefined,
    FormData
  >(async (prev, fd) => {
    const files = fd
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0);
    fd.delete("photos");
    if (files.length > 12) return { error: "At most 12 photos per bill." };

    const batch = crypto.randomUUID();
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
      const path = `${locationId}/${batch}/po${i}.${ext}`;
      const { error } = await supabase.storage
        .from("purchase-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (error) return { error: `Photo upload failed: ${error.message}` };
      paths.push(path);
    }
    fd.set("photo_paths", JSON.stringify(paths));

    const out = lines
      .map((l) => ({
        line_id: l.id,
        qty: Number(fd.get(`qty_${l.id}`) ?? 0),
        unit_price: Number(fd.get(`price_${l.id}`) ?? 0),
      }))
      .filter((l) => l.qty > 0);
    if (out.length === 0) return { error: "Enter at least one received quantity." };
    fd.set("lines", JSON.stringify(out));
    return receivePurchaseOrder(prev, fd);
  }, undefined);

  // The server components above the panel show stale numbers after a
  // transition — refresh once per successful action (token changes each time).
  useEffect(() => {
    if (
      approveState?.success ||
      rejectState?.success ||
      cancelState?.success ||
      dispatchState?.success ||
      receiveState?.success
    ) {
      router.refresh();
    }
  }, [
    approveState?.token,
    rejectState?.token,
    cancelState?.token,
    dispatchState?.token,
    receiveState?.token,
    approveState?.success,
    rejectState?.success,
    cancelState?.success,
    dispatchState?.success,
    receiveState?.success,
    router,
  ]);

  const anyPending =
    approvePending || rejectPending || cancelPending || dispatchPending || receivePending;

  const banner = TERMINAL_BANNERS[order.status];
  if (banner) {
    return (
      <div className={`rounded-lg border px-4 py-3 text-sm ${banner.cls}`}>
        <span className="font-semibold">{order.status}</span> — {banner.text}
      </div>
    );
  }

  const cancelForm = (
    <form key={cancelState?.token ?? "init"} action={cancelAction} className="space-y-3">
      <input type="hidden" name="po_id" value={order.id} />
      <button
        type="submit"
        disabled={anyPending}
        className="rounded-lg border border-[#d9d1c1] bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-[#f3eee3] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {cancelPending ? "Cancelling…" : "Cancel request"}
      </button>
      <FormFeedback feedback={fb(cancelState)} />
    </form>
  );

  if (order.status === "PENDING") {
    if (!canReview) {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-[#e6e0d3] bg-[#efe9dd] px-4 py-3 text-sm text-neutral-600">
            <span className="font-semibold">PENDING</span> — Waiting for
            admin/manager review.
          </div>
          {cancelForm}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <form
          key={approveState?.token ?? "init"}
          action={approveAction}
          className={cardCls}
        >
          <input type="hidden" name="po_id" value={order.id} />
          <input type="hidden" name="decision" value="approve" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Approve {order.po_number}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              Adjust quantities before approving — the requester asked for the
              amounts shown; set a line to 0 to skip it.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lines.map((l) => (
              <Field
                key={l.id}
                label={`${l.name}${l.unit ? ` (${l.unit})` : ""}`}
                hint={`requested ${l.requested_qty}${l.code ? ` · ${l.code}` : ""}`}
              >
                <input
                  name={`qty_${l.id}`}
                  type="number"
                  step="any"
                  min="0"
                  required
                  defaultValue={l.approved_qty ?? l.requested_qty}
                  className={inputCls}
                />
              </Field>
            ))}
          </div>
          <FormFeedback feedback={fb(approveState)} />
          <div className="sm:max-w-xs">
            <SubmitButton pending={approvePending} pendingLabel="Approving…">
              Approve order
            </SubmitButton>
          </div>
        </form>

        <div className="flex flex-wrap items-start gap-3">
          <form
            key={rejectState?.token ?? "init"}
            action={rejectAction}
            className="space-y-3"
          >
            <input type="hidden" name="po_id" value={order.id} />
            <input type="hidden" name="decision" value="reject" />
            <button
              type="submit"
              disabled={anyPending}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejectPending ? "Rejecting…" : "Reject request"}
            </button>
            <FormFeedback feedback={fb(rejectState)} />
          </form>
          {cancelForm}
        </div>
      </div>
    );
  }

  if (order.status === "APPROVED" && order.kind === "INDENT") {
    return (
      <div className="space-y-4">
        <form
          key={dispatchState?.token ?? "init"}
          action={dispatchAction}
          className={cardCls}
        >
          <input type="hidden" name="po_id" value={order.id} />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Dispatch {order.po_number}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              Moves stock out of the Store to the requesting department in one
              atomic transfer.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lines.map((l) => (
              <Field
                key={l.id}
                label={`${l.name}${l.unit ? ` (${l.unit})` : ""}`}
                hint={`approved ${l.approved_qty ?? l.requested_qty}${l.code ? ` · ${l.code}` : ""}`}
              >
                <input
                  name={`qty_${l.id}`}
                  type="number"
                  step="any"
                  min="0"
                  required
                  defaultValue={l.approved_qty ?? l.requested_qty}
                  className={inputCls}
                />
              </Field>
            ))}
          </div>
          <FormFeedback feedback={fb(dispatchState)} />
          <div className="sm:max-w-xs">
            <SubmitButton pending={dispatchPending} pendingLabel="Dispatching…">
              Dispatch to department
            </SubmitButton>
          </div>
        </form>
        {cancelForm}
      </div>
    );
  }

  if (order.status === "APPROVED" && order.kind === "VENDOR") {
    return (
      <div className="space-y-4">
        <form
          key={receiveState?.token ?? "init"}
          action={receiveAction}
          className={cardCls}
        >
          <input type="hidden" name="po_id" value={order.id} />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Receive {order.po_number}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              Enter what actually arrived and the billed prices — this posts the
              purchase bill and updates stock in one step.
            </p>
          </div>

          <div className="space-y-3">
            {lines.map((l) => (
              <div
                key={l.id}
                className="grid gap-3 rounded-lg border border-[#e6e0d3] bg-white p-3 sm:grid-cols-2"
              >
                <Field
                  label={`${l.name}${l.unit ? ` (${l.unit})` : ""}`}
                  hint={`approved ${l.approved_qty ?? l.requested_qty}${l.code ? ` · ${l.code}` : ""}`}
                >
                  <input
                    name={`qty_${l.id}`}
                    type="number"
                    step="any"
                    min="0"
                    required
                    defaultValue={l.approved_qty ?? l.requested_qty}
                    className={inputCls}
                  />
                </Field>
                <Field
                  label="Actual unit price (₹)"
                  hint={
                    l.expected_unit_price === null
                      ? "no expected price"
                      : `expected ${inr(l.expected_unit_price)}`
                  }
                >
                  <input
                    name={`price_${l.id}`}
                    type="number"
                    step="any"
                    min="0"
                    required
                    defaultValue={l.expected_unit_price ?? ""}
                    className={inputCls}
                  />
                </Field>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Bill / invoice no." hint="as printed on the bill">
              <input name="invoice_no" placeholder="INV-1042" className={inputCls} />
            </Field>
            <Field label="Bill date">
              <input
                name="bill_date"
                type="date"
                defaultValue={today}
                max={today}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Bill photos" hint="snap the bill + delivered goods (optional)">
              <input
                name="photos"
                type="file"
                multiple
                accept="image/*"
                capture="environment"
                className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-neutral-700"
              />
            </Field>
          </div>

          <FormFeedback feedback={fb(receiveState)} />
          <div className="sm:max-w-xs">
            <SubmitButton pending={receivePending} pendingLabel="Receiving…">
              Receive &amp; post bill
            </SubmitButton>
          </div>
        </form>
        {cancelForm}
      </div>
    );
  }

  // Unknown/unhandled status — surface it instead of hiding the panel.
  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#efe9dd] px-4 py-3 text-sm text-neutral-600">
      <span className="font-semibold">{order.status}</span> — no actions available.
    </div>
  );
}
