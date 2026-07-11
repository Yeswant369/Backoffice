"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";

export interface PoState {
  error?: string;
  success?: string;
  token?: string;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const qtyOk = (v: number) => Number.isFinite(v) && v > 0 && v < 1e10;

async function home(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

/** Map RPC exception prefixes to operator-friendly messages. */
function friendly(msg: string): string {
  if (msg.includes("INSUFFICIENT:")) return msg.split("INSUFFICIENT:")[1].trim().replace(/^only/, "Only");
  if (msg.includes("BAD_STATUS:")) return "This order was already processed.";
  if (msg.includes("NOT_FOUND:")) return "Order not found in your location.";
  if (msg.includes("NO_STORE:")) return 'No "Store" department is configured.';
  if (msg.includes("VENDOR_NOT_APPROVED:")) return "Approve the vendor first (Vendor Hub).";
  if (msg.includes("BAD_PHOTO:")) return "Invalid photo reference — retake the photo and try again.";
  if (msg.includes("BAD_LINE:")) return "A line doesn't belong to this order — reload and retry.";
  if (msg.includes("BAD_QTY:") || msg.includes("BAD_PRICE:")) return "Quantities and prices must be valid positive numbers.";
  if (msg.includes("BAD_DATE:")) return "The bill date looks wrong.";
  if (msg.includes("BAD_KIND:") || msg.includes("BAD_TARGET:")) return "This order can't be processed that way.";
  if (msg.includes("OVER_APPROVED:")) return msg.split("OVER_APPROVED:")[1].trim().replace(/^line/, "A line");
  if (msg.includes("PO_ROLE:")) return "You don't have the role required for that step.";
  if (msg.includes("PO_TRANSITION:") || msg.includes("PO_IMMUTABLE:") || msg.includes("PO_LINES:"))
    return "That change isn't allowed at this order's stage.";
  return msg;
}

const REVALIDATE = () => {
  revalidatePath("/dashboard/admin/procurement/orders");
  revalidatePath("/dashboard/admin/inventory/live-stock");
};

/**
 * Create a purchase order (external vendor) or indent request (internal, from
 * the Store to a department). Any operational role may raise one — it lands
 * PENDING for admin/manager review.
 */
export async function createPurchaseOrder(
  _prev: PoState | undefined,
  fd: FormData,
): Promise<PoState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => [1, 2, 3, 4].includes(r))) {
    return { error: "You are not authorized to raise requests." };
  }

  const vendor_id = str(fd, "vendor_id") || null;
  const deptRaw = str(fd, "to_department_id");
  const to_department_id = deptRaw ? Math.floor(Number(deptRaw)) : null;
  const notes = str(fd, "notes") || null;
  const kind = vendor_id ? "VENDOR" : "INDENT";
  if (kind === "INDENT" && !to_department_id) {
    return { error: "Pick a vendor (external order) or a department (internal indent)." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "lines"));
  } catch {
    return { error: "Invalid line items." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Add at least one line item." };
  if (parsed.length > 100) return { error: "Too many lines on one request." };

  const lines: { raw_material_id: string; requested_qty: number; expected_unit_price: number | null }[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid line items." };
    const l = raw as Record<string, unknown>;
    const raw_material_id = typeof l.raw_material_id === "string" ? l.raw_material_id : "";
    const requested_qty = Number(l.requested_qty);
    const price =
      l.expected_unit_price === null || l.expected_unit_price === "" || l.expected_unit_price === undefined
        ? null
        : Number(l.expected_unit_price);
    if (!raw_material_id) return { error: "Every line needs a material." };
    if (seen.has(raw_material_id)) return { error: "Each material can only appear once." };
    seen.add(raw_material_id);
    if (!qtyOk(requested_qty)) return { error: "Every quantity must be greater than zero." };
    if (price !== null && (!Number.isFinite(price) || price < 0 || price >= 1e10)) {
      return { error: "Expected prices must be valid non-negative numbers." };
    }
    lines.push({ raw_material_id, requested_qty, expected_unit_price: price });
  }

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  if (kind === "VENDOR") {
    const { data: vend } = await supabase
      .from("vendors")
      .select("id, approved")
      .eq("id", vendor_id!)
      .eq("location_id", loc)
      .maybeSingle();
    if (!vend) return { error: "Vendor not found in your location." };
    if (!(vend as { approved: boolean }).approved) {
      return { error: "This vendor isn't approved yet — approve it in the Vendor Hub first." };
    }
  } else {
    const { data: dep } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", to_department_id!)
      .eq("location_id", loc)
      .maybeSingle();
    if (!dep) return { error: "Department not found in your location." };
    if (String(dep.name).trim().toLowerCase() === "store") {
      return { error: "Indents move stock OUT of the Store — pick the requesting department." };
    }
  }

  const ids = lines.map((l) => l.raw_material_id);
  const { data: mats } = await supabase
    .from("raw_materials")
    .select("id")
    .in("id", ids)
    .eq("location_id", loc);
  if ((mats ?? []).length !== ids.length) {
    return { error: "One or more materials weren't found in your location." };
  }

  // Sequential number per outlet per kind (PO-0001 / IND-0001); retry once on a race.
  const prefix = kind === "VENDOR" ? "PO-" : "IND-";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { count } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("location_id", loc)
      .eq("kind", kind);
    const po_number = `${prefix}${String((count ?? 0) + 1 + attempt).padStart(4, "0")}`;

    const { data: po, error } = await supabase
      .from("purchase_orders")
      .insert({
        location_id: loc,
        po_number,
        kind,
        vendor_id,
        to_department_id: kind === "INDENT" ? to_department_id : null,
        notes,
        requested_by: user.id,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505" && attempt === 0) continue; // number race — retry
      return { error: error.message };
    }

    const { error: lineErr } = await supabase
      .from("purchase_order_lines")
      .insert(lines.map((l) => ({ po_id: po.id, location_id: loc, ...l })));
    if (lineErr) return { error: lineErr.message };

    REVALIDATE();
    return {
      success: `${kind === "VENDOR" ? "Purchase order" : "Indent"} ${po_number} submitted for approval.`,
      token: crypto.randomUUID(),
    };
  }
  return { error: "Could not allocate an order number — try again." };
}

/** Approve (with optional per-line quantity adjustments) or reject a PENDING order. */
export async function reviewPurchaseOrder(
  _prev: PoState | undefined,
  fd: FormData,
): Promise<PoState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => [1, 2].includes(r))) {
    return { error: "Only admins/managers can review requests." };
  }

  const po_id = str(fd, "po_id");
  const decision = str(fd, "decision"); // approve | reject
  if (!po_id || !["approve", "reject"].includes(decision)) return { error: "Invalid review." };

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // The order must still be PENDING before ANY mutation — otherwise two
  // concurrent reviewers could adjust lines on an already-processed order.
  const { data: current } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", po_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!current) return { error: "Request not found in your location." };
  if (current.status !== "PENDING") return { error: "Request already processed." };

  // Optional adjusted quantities: {line_id: qty}
  if (decision === "approve") {
    let adjusted: Record<string, unknown> = {};
    try {
      adjusted = JSON.parse(str(fd, "adjustments") || "{}");
    } catch {
      return { error: "Invalid adjustments." };
    }
    for (const [lineId, v] of Object.entries(adjusted)) {
      const q = Number(v);
      if (!Number.isFinite(q) || q < 0 || q >= 1e10) return { error: "Adjusted quantities must be non-negative numbers." };
      const { error } = await supabase
        .from("purchase_order_lines")
        .update({ approved_qty: q })
        .eq("id", lineId)
        .eq("po_id", po_id)
        .eq("location_id", loc);
      if (error) return { error: error.message };
    }
  }

  const { data: updated, error } = await supabase
    .from("purchase_orders")
    .update({
      status: decision === "approve" ? "APPROVED" : "REJECTED",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", po_id)
    .eq("location_id", loc)
    .eq("status", "PENDING")
    .select("id, po_number");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Request not found or already processed." };
  }

  REVALIDATE();
  return {
    success: `${updated[0].po_number} ${decision === "approve" ? "approved" : "rejected"}.`,
    token: crypto.randomUUID(),
  };
}

/** Dispatch an internal indent — atomic Store→department transfer via RPC. */
export async function dispatchIndent(
  _prev: PoState | undefined,
  fd: FormData,
): Promise<PoState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => [1, 2, 3].includes(r))) {
    return { error: "Only admins/managers/store can dispatch." };
  }

  const po_id = str(fd, "po_id");
  if (!po_id) return { error: "Missing order." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "lines"));
  } catch {
    return { error: "Invalid dispatch lines." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Nothing to dispatch." };
  const seenDispatch = new Set<string>();
  for (const raw of parsed) {
    const l = raw as Record<string, unknown>;
    if (!l || typeof l !== "object" || typeof l.line_id !== "string" || !qtyOk(Number(l.qty))) {
      return { error: "Dispatch quantities must be greater than zero." };
    }
    if (seenDispatch.has(l.line_id)) return { error: "Duplicate line in dispatch." };
    seenDispatch.add(l.line_id);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("dispatch_indent", { p_po_id: po_id, p_lines: parsed });
  if (error) return { error: friendly(error.message ?? "Dispatch failed.") };

  REVALIDATE();
  return { success: "Dispatched — stock moved to the department.", token: crypto.randomUUID() };
}

/** Receive a vendor PO — atomic bill (multi-photo) + PURCHASE ledger via RPC. */
export async function receivePurchaseOrder(
  _prev: PoState | undefined,
  fd: FormData,
): Promise<PoState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => [1, 2, 3].includes(r))) {
    return { error: "Only admins/managers/store can receive." };
  }

  const po_id = str(fd, "po_id");
  const invoice_no = str(fd, "invoice_no");
  const bill_date = str(fd, "bill_date");
  if (!po_id) return { error: "Missing order." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill_date)) return { error: "Select a valid bill date." };

  let photos: unknown;
  try {
    photos = JSON.parse(str(fd, "photo_paths") || "[]");
  } catch {
    return { error: "Invalid photos." };
  }
  if (!Array.isArray(photos) || photos.some((p) => typeof p !== "string") || photos.length > 12) {
    return { error: "Invalid photos." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "lines"));
  } catch {
    return { error: "Invalid receive lines." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Nothing to receive." };
  const seenReceive = new Set<string>();
  for (const raw of parsed) {
    const l = raw as Record<string, unknown>;
    if (
      !l || typeof l !== "object" || typeof l.line_id !== "string" ||
      !qtyOk(Number(l.qty)) ||
      !Number.isFinite(Number(l.unit_price)) || Number(l.unit_price) < 0 || Number(l.unit_price) >= 1e10
    ) {
      return { error: "Received quantities and prices must be valid numbers." };
    }
    if (seenReceive.has(l.line_id)) return { error: "Duplicate line in receive." };
    seenReceive.add(l.line_id);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_purchase_order", {
    p_po_id: po_id,
    p_invoice_no: invoice_no,
    p_bill_date: bill_date,
    p_photo_paths: photos,
    p_lines: parsed,
  });
  if (error) return { error: friendly(error.message ?? "Receiving failed.") };

  REVALIDATE();
  revalidatePath("/dashboard/admin/procurement/purchase-log");
  return { success: "Received — stock and last-purchase prices updated.", token: crypto.randomUUID() };
}

/** Cancel a PENDING/APPROVED order (admin/manager, or the requester). */
export async function cancelPurchaseOrder(
  _prev: PoState | undefined,
  fd: FormData,
): Promise<PoState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user) return { error: "Not signed in." };

  const po_id = str(fd, "po_id");
  if (!po_id) return { error: "Missing order." };

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  let q = supabase
    .from("purchase_orders")
    .update({ status: "CANCELLED", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", po_id)
    .eq("location_id", loc)
    .in("status", ["PENDING", "APPROVED"]);
  // Non-managers may only cancel their own requests.
  if (!roles.some((r) => [1, 2].includes(r))) q = q.eq("requested_by", user.id);
  const { data: updated, error } = await q.select("id, po_number");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Request not found or already processed." };

  REVALIDATE();
  return { success: `${updated[0].po_number} cancelled.`, token: crypto.randomUUID() };
}
