interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  /** Optional emphasis tone for the value. */
  tone?: "default" | "positive" | "negative";
}

const TONE: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-neutral-900",
  positive: "text-emerald-600",
  negative: "text-red-600",
};

/** High-end monochrome metric tile for financial figures. */
export default function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: MetricCardProps) {
  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${TONE[tone]}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-neutral-600">{sub}</p>}
    </div>
  );
}
