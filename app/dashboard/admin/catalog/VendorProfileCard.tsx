"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { VendorRow } from "./types";

function statusTone(status: string) {
  const s = status.toUpperCase();
  if (s === "ACTIVE")
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-600";
  if (s === "BLACKLISTED")
    return "border-red-400/30 bg-red-400/10 text-red-600";
  return "border-[#d9d1c1] bg-[#f7f3ec] text-neutral-700";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="rounded-md border border-[#e6e0d3] px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 transition hover:border-[#cdc4b1] hover:text-neutral-900"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Detail({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  copy?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <p
          className={`truncate text-sm ${value ? "text-neutral-900" : "text-neutral-500"} ${mono ? "font-mono" : ""}`}
        >
          {value || "—"}
        </p>
        {copy && value ? <CopyButton value={value} /> : null}
      </div>
    </div>
  );
}

function Group({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-neutral-600">
        {icon}
        <h4 className="text-[11px] font-semibold uppercase tracking-widest">
          {title}
        </h4>
      </div>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

export default function VendorProfileCard({ vendor }: { vendor: VendorRow }) {
  const initials =
    vendor.name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "V";

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3.5 border-b border-[#e6e0d3] pb-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[#d9d1c1] bg-[#efe9dd] text-sm font-semibold text-neutral-900">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-neutral-900">
            {vendor.name}
          </p>
          <p className="font-mono text-xs text-neutral-500">
            {vendor.vendor_code}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusTone(vendor.status)}`}
        >
          {vendor.status}
        </span>
      </div>

      {/* Detail groups */}
      <div className="mt-4 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <Group
          title="Contact"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
          }
        >
          <Detail label="Contact person" value={vendor.contact_person} />
          <Detail label="Phone" value={vendor.phone} copy />
          <Detail label="Email" value={vendor.email} copy />
        </Group>

        <Group
          title="Banking"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M3 21h18M4 10h16M5 10V7l7-4 7 4v3M6 10v8M10 10v8M14 10v8M18 10v8" />
            </svg>
          }
        >
          <Detail label="Bank name" value={vendor.bank_name} />
          <Detail label="Account number" value={vendor.account_number} mono copy />
          <Detail label="IFSC code" value={vendor.ifsc_code} mono copy />
        </Group>
      </div>
    </div>
  );
}
