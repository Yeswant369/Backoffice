interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

/** Shared premium page header for dashboard sections. */
export default function SectionHeader({
  eyebrow,
  title,
  description,
}: SectionHeaderProps) {
  return (
    <header className="mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900">
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">{description}</p>
    </header>
  );
}

/** Glass placeholder tile used until each module is implemented. */
export function ModuleCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5 transition hover:border-[#d9d1c1] hover:bg-[#efe9dd]">
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
        {description}
      </p>
      <span className="mt-4 inline-block rounded-full border border-[#e6e0d3] bg-[#f7f3ec] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        Coming in a later phase
      </span>
    </div>
  );
}
