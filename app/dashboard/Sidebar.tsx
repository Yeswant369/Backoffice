"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  ADMIN_NAV,
  accessibleSections,
  rolesCanAccessSection,
  STANDALONE_NAV,
  ROLES,
  type RoleId,
  type Section,
} from "@/lib/roles";
import { logout } from "./actions";
import LocationSwitcher from "./_components/LocationSwitcher";

const ease = [0.22, 1, 0.36, 1] as const;

/** Minimal monochrome line icons keyed by role section (non-admin nav). */
const SECTION_ICONS: Record<Section, string> = {
  portfolio:
    "M3 21h18|M5 21V8l7-5 7 5v13|M9 21v-6h6v6|M9 11h.01|M15 11h.01",
  admin: "M12 3l8 4v5c0 4.5-3 7.5-8 9-5-1.5-8-4.5-8-9V7l8-4z",
  manager: "M3 13h4v8H3v-8zm7-6h4v14h-4V7zm7 3h4v11h-4V10z",
  store: "M4 7h16M4 7l1-3h14l1 3M4 7v12a1 1 0 001 1h14a1 1 0 001-1V7M9 11h6",
  kitchen: "M8 3v7a3 3 0 003 3v8m2-18a3 3 0 013 3v4a3 3 0 01-3 3",
};

interface SidebarProps {
  roles: RoleId[];
  fullName: string;
  email: string;
  locations: { id: string; name: string }[];
  activeLocationId: string | null;
}

/** A single sidebar link with the shared active indicator + entrance animation. */
function NavRow({
  href,
  label,
  description,
  icon,
  active,
  delay,
}: {
  href: string;
  label: string;
  description?: string;
  icon: string;
  active: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease, delay }}
    >
      <Link
        href={href}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
          active
            ? "bg-[#efe9dd] text-neutral-900"
            : "text-neutral-600 hover:bg-[#efe9dd] hover:text-neutral-900"
        }`}
      >
        {active && (
          <motion.span
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-indigo-500"
            transition={{ duration: 0.3, ease }}
          />
        )}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 flex-shrink-0 ${active ? "text-indigo-600" : ""}`}
          aria-hidden
        >
          {icon.split("|").map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{label}</span>
          {description && (
            <span className="truncate text-[11px] text-neutral-600 group-hover:text-neutral-700">
              {description}
            </span>
          )}
        </span>
      </Link>
    </motion.div>
  );
}

export default function Sidebar({
  roles,
  fullName,
  email,
  locations,
  activeLocationId,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const [signingOut, setSigningOut] = useState(false);

  const isAdmin = roles.includes(ROLES.ADMIN);
  const canPortfolio = rolesCanAccessSection(roles, "portfolio");
  const canManageTeam = roles.includes(ROLES.OWNER);
  // Portfolio renders once at the top for any cross-outlet user (incl. an
  // owner-operator on the admin nav); exclude it from the role-section list.
  const sections = accessibleSections(roles).filter((s) => s.key !== "portfolio");
  // Other dashboards a full-access admin can jump into (Kitchen / Store / Mgmt).
  const otherWorkspaces = sections.filter((s) => s.key !== "admin");

  const initials =
    fullName
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  /** Active match for grouped admin items (handles ?tab= catalog deep-links). */
  function adminItemActive(href: string): boolean {
    const [base, query] = href.split("?");
    if (query) {
      if (pathname !== base) return false;
      const wantTab = new URLSearchParams(query).get("tab");
      // catalog defaults to the materials tab when no ?tab= is present
      return tab === wantTab || (wantTab === "materials" && !tab);
    }
    if (base === "/dashboard/admin") return pathname === base; // exact (root)
    return pathname === base || pathname.startsWith(base + "/");
  }

  return (
    <aside className="sticky top-0 flex h-dvh w-72 flex-shrink-0 flex-col border-r border-[#e6e0d3] bg-[#f7f3ec]">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-100">
          <span className="text-xs font-semibold tracking-tight text-indigo-700">
            BOH
          </span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-neutral-900">Back of House</p>
          <p className="text-[11px] text-neutral-500">ERP Control</p>
        </div>
      </div>

      {/* Outlet switcher (cross-outlet roles only; hidden for single-location users) */}
      <LocationSwitcher locations={locations} activeId={activeLocationId} />

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {canPortfolio && (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Overview
            </p>
            <NavRow
              href="/dashboard/portfolio"
              label="Portfolio"
              description="Cross-outlet roll-up"
              icon={SECTION_ICONS.portfolio}
              active={
                pathname === "/dashboard/portfolio" &&
                !pathname.startsWith("/dashboard/portfolio/team")
              }
              delay={0}
            />
            {canManageTeam && (
              <NavRow
                href="/dashboard/portfolio/team"
                label="Team & Access"
                description="Staff & outlet assignment"
                icon="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8z|M19 8v6|M22 11h-6"
                active={pathname.startsWith("/dashboard/portfolio/team")}
                delay={0.04}
              />
            )}
          </div>
        )}
        {isAdmin ? (
          <>
            {ADMIN_NAV.map((group) => (
              <div key={group.title} className="space-y-1">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  {group.title}
                </p>
                {group.items.map((item, i) => (
                  <NavRow
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={adminItemActive(item.href)}
                    delay={0.03 * i}
                  />
                ))}
              </div>
            ))}
            {otherWorkspaces.length > 0 && (
              <div className="space-y-1">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Workspaces
                </p>
                {otherWorkspaces.map((section, i) => (
                  <NavRow
                    key={section.key}
                    href={section.href}
                    label={section.label}
                    description={section.description}
                    icon={SECTION_ICONS[section.key]}
                    active={
                      pathname === section.href ||
                      pathname.startsWith(section.href + "/")
                    }
                    delay={0.03 * i}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Workspaces
            </p>
            {sections.map((section, i) => (
              <NavRow
                key={section.key}
                href={section.href}
                label={section.label}
                description={section.description}
                icon={SECTION_ICONS[section.key]}
                active={
                  pathname === section.href ||
                  pathname.startsWith(section.href + "/")
                }
                delay={0.05 * i}
              />
            ))}
            {STANDALONE_NAV.map((item, i) => (
              <NavRow
                key={item.href}
                href={item.href}
                label={item.label}
                description={item.description}
                icon={item.icon}
                active={
                  pathname === item.href || pathname.startsWith(item.href + "/")
                }
                delay={0.05 * (sections.length + i)}
              />
            ))}
          </div>
        )}
      </nav>

      {/* User + logout */}
      <div className="border-t border-[#e6e0d3] p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#d9d1c1] bg-[#efe9dd] text-xs font-semibold text-neutral-900">
            {initials}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-neutral-900">{fullName}</p>
            <p className="truncate text-[11px] text-neutral-500">{email}</p>
          </div>
        </div>

        <form action={logout}>
          <button
            type="submit"
            onClick={() => setSigningOut(true)}
            disabled={signingOut}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-600 transition hover:bg-[#efe9dd] hover:text-neutral-900 disabled:opacity-60"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M15 12H3m0 0l4-4m-4 4l4 4M21 3v18" />
            </svg>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </form>
      </div>
    </aside>
  );
}
