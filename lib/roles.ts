/**
 * Single source of truth for the BOH ERP role model.
 *
 * roles INT[] on `profiles`:
 *   1 = Admin, 2 = Manager, 3 = Store, 4 = Kitchen   (location-scoped)
 *   5 = Area Manager, 6 = Owner                       (cross-outlet, READ-only roll-ups)
 *
 * Roles 5/6 are recognized at the DB layer (RLS grants Owners org-wide reads and
 * Area Managers their assigned outlets — see current_location_ids()) and, from
 * Phase 2b, share the read-only "portfolio" SECTION + the location switcher.
 *
 * Each role maps to one or more dashboard sections. A user may hold several
 * roles, so the sidebar and route guards operate on the role array.
 */

export const ROLES = {
  ADMIN: 1,
  MANAGER: 2,
  STORE: 3,
  KITCHEN: 4,
  AREA_MANAGER: 5,
  OWNER: 6,
} as const;

export type RoleId = (typeof ROLES)[keyof typeof ROLES];

/**
 * Roles that operate a single outlet and may WRITE its data. Excludes the
 * cross-outlet roles 5/6, whose access is read-only roll-ups — use this (not
 * `roles.length`) to guard write actions/pages so 5/6 can't reach them.
 */
export const OPERATIONAL_ROLES: RoleId[] = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.STORE,
  ROLES.KITCHEN,
];

/** Short display labels for individual roles (used in badges, tables). */
export const ROLE_LABELS: Record<RoleId, string> = {
  1: "Admin",
  2: "Manager",
  3: "Store",
  4: "Kitchen",
  5: "Area Manager",
  6: "Owner",
};

/**
 * Roles a LOCATION ADMIN may assign via the staff invite (intra-location).
 *
 * Cross-outlet Owner (6) is intentionally EXCLUDED here: granting org-wide read
 * is an org-level act, so it's gated to existing Owners (OWNER_ASSIGNABLE_ROLES)
 * — otherwise a home-scoped admin could self-escalate to org-wide visibility by
 * minting an Owner account on an email they control.
 *
 * Area Manager (5) is not yet UI-assignable: it only becomes useful once its
 * outlets are set in profile_locations, which ships with the owner management
 * surface (Phase 2c). Until then, assign it via the service role.
 */
export const ASSIGNABLE_ROLES: { id: RoleId; label: string }[] = [
  { id: ROLES.ADMIN, label: "Admin" },
  { id: ROLES.MANAGER, label: "Manager" },
  { id: ROLES.STORE, label: "Store" },
  { id: ROLES.KITCHEN, label: "Kitchen" },
];

/** Roles an ORG OWNER may assign — Owner plus all location roles. */
export const OWNER_ASSIGNABLE_ROLES: { id: RoleId; label: string }[] = [
  { id: ROLES.OWNER, label: "Owner" },
  ...ASSIGNABLE_ROLES,
];

/**
 * Roles an OWNER may grant to a team member (per outlet) from the owner Team
 * surface. Excludes Owner (co-owner appointment is a heavier act) and is the
 * set of operational + cross-outlet roles an owner staffs their outlets with.
 */
export const OWNER_TEAM_ROLES: { id: RoleId; label: string }[] = [
  { id: ROLES.ADMIN, label: "Admin" },
  { id: ROLES.MANAGER, label: "Manager" },
  { id: ROLES.STORE, label: "Store" },
  { id: ROLES.KITCHEN, label: "Kitchen" },
  { id: ROLES.AREA_MANAGER, label: "Area Manager" },
];

export type Section = "portfolio" | "admin" | "manager" | "store" | "kitchen";

export interface SectionDef {
  key: Section;
  /** Any one of these roles grants access to the section. */
  roles: RoleId[];
  href: string;
  label: string;
  description: string;
}

/**
 * Ordered by privilege. The first section a user can access becomes their
 * "home" landing route after login. Operational sections lead, so an
 * owner-operator (Admin + Owner) lands on their working dashboard; a pure
 * Owner / Area Manager (no operational role) lands on Portfolio.
 */
export const SECTIONS: SectionDef[] = [
  {
    key: "admin",
    roles: [ROLES.ADMIN],
    href: "/dashboard/admin",
    label: "Administration",
    description: "Vendors, materials, recipes & system control",
  },
  {
    key: "manager",
    roles: [ROLES.MANAGER],
    href: "/dashboard/manager",
    label: "Management",
    description: "Vendor dues, reconciliation & petty cash",
  },
  {
    key: "store",
    roles: [ROLES.STORE],
    href: "/dashboard/store",
    label: "Store & Inventory",
    description: "Live stock, purchases & transfers",
  },
  {
    key: "kitchen",
    roles: [ROLES.KITCHEN],
    href: "/dashboard/kitchen",
    label: "Kitchen",
    description: "Issues, recipes & wastage",
  },
  {
    key: "portfolio",
    roles: [ROLES.OWNER, ROLES.AREA_MANAGER],
    href: "/dashboard/portfolio",
    label: "Portfolio",
    description: "Cross-outlet roll-up & per-location view",
  },
];

const SECTION_BY_KEY = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s]),
) as Record<Section, SectionDef>;

/** A standalone nav item (not tied to a role) — shown to every signed-in user. */
export interface NavLink {
  href: string;
  label: string;
  description: string;
  /** SVG path data for a 24×24 stroke icon. */
  icon: string;
}

/** Cross-cutting workspaces, rendered below the role sections in the sidebar. */
export const STANDALONE_NAV: NavLink[] = [
  {
    href: "/dashboard/analytics",
    label: "Analytics",
    description: "Cash flow & revenue trends",
    icon: "M3 3v18h18M7 15l4-4 3 2 5-6",
  },
];

/**
 * Grouped, intent-based navigation for ADMIN users — the enterprise SaaS layout.
 * Replaces the old per-role "workspace soup" for admins: data-viewing dashboards,
 * action/operations pages, and master-data setup are cleanly separated.
 */
export interface AdminNavItem {
  href: string;
  label: string;
  /** One or more 24×24 stroke path strings, '|'-separated. */
  icon: string;
}
export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: "Dashboards",
    items: [
      {
        href: "/dashboard/admin",
        label: "Financial Overview",
        icon: "M3 13h4v8H3zM10 7h4v14h-4zM17 10h4v11h-4z",
      },
      {
        href: "/dashboard/admin/analytics/variance",
        label: "Variance Analysis",
        icon: "M3 3v18h18|M7 14l3-3 3 2 5-6",
      },
      {
        href: "/dashboard/admin/departments",
        label: "Department P&L",
        icon: "M3 3v18h18|M7 16l3-4 3 2 4-6",
      },
      {
        href: "/dashboard/admin/analytics/menu-engineering",
        label: "Menu Engineering",
        icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
      },
      {
        href: "/dashboard/admin/analytics/profit",
        label: "Cost & Profit",
        icon: "M12 1v22|M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6|M5 9h.01",
      },
      {
        href: "/dashboard/admin/analytics/pos",
        label: "POS Sales",
        icon: "M3 3h18v4H3z|M3 7v13a1 1 0 001 1h16a1 1 0 001-1V7|M8 11h8|M8 15h5",
      },
      {
        href: "/dashboard/admin/anomalies",
        label: "Anomalies",
        icon: "M10.29 3.86l-8.4 14.55A1 1 0 002.76 20h18.48a1 1 0 00.87-1.5L13.71 3.86a1 1 0 00-1.74 0z|M12 9v4|M12 17h.01",
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        href: "/dashboard/admin/procurement/purchase-log",
        label: "Procure-to-Pay",
        icon: "M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0",
      },
      {
        href: "/dashboard/admin/procurement/reorder",
        label: "Reorder",
        icon: "M21 2v6h-6|M3 12a9 9 0 0115-6.7L21 8|M3 22v-6h6|M21 12a9 9 0 01-15 6.7L3 16",
      },
      {
        href: "/dashboard/admin/inventory/issue-stock",
        label: "Inventory Control",
        icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10",
      },
      {
        href: "/dashboard/admin/inventory/live-stock",
        label: "Live Stock",
        icon: "M3 3v18h18|M7 14l4-4 3 3 5-6",
      },
      {
        href: "/dashboard/admin/inventory/count",
        label: "Stock Counting",
        icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
      },
      {
        href: "/dashboard/admin/kitchen-production",
        label: "Kitchen Production",
        icon: "M8 3v7a3 3 0 003 3v8m2-18a3 3 0 013 3v4a3 3 0 01-3 3",
      },
      {
        href: "/dashboard/admin/sales",
        label: "Record Sale",
        icon: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z|M7 7h.01",
      },
      {
        href: "/dashboard/admin/reconciliation",
        label: "Daily Reconciliation",
        icon: "M5 3h14a1 1 0 011 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 011-1z|M9 8h6M9 12h6",
      },
      {
        href: "/dashboard/admin/petty-cash",
        label: "Petty Cash",
        icon: "M2 7h20v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M2 7l3-4h14l3 4|M12 12h.01",
      },
      {
        href: "/dashboard/admin/dues",
        label: "Dues Tracker",
        icon: "M12 1v22|M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
      },
      {
        href: "/dashboard/admin/accounting",
        label: "Accounting Export",
        icon: "M4 3h16v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z|M8 7h8M8 11h8M8 15h5",
      },
    ],
  },
  {
    title: "Master Data",
    items: [
      {
        href: "/dashboard/admin/catalog?tab=materials",
        label: "Raw Materials Catalog",
        icon: "M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z|M3.3 7L12 12l8.7-5M12 22V12",
      },
      {
        href: "/dashboard/admin/catalog?tab=recipes",
        label: "Recipe Builder",
        icon: "M8 3v7a3 3 0 003 3v8m2-18a3 3 0 013 3v4a3 3 0 01-3 3",
      },
      {
        href: "/dashboard/admin/procurement/vendors",
        label: "Vendor Directory",
        icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        href: "/dashboard/admin/settings",
        label: "Settings",
        icon: "M12 15a3 3 0 100-6 3 3 0 000 6z|M19.4 13a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 009 19.3a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1A1.6 1.6 0 004.7 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z",
      },
      {
        href: "/dashboard/admin/staff",
        label: "Manage Staff",
        icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
      },
    ],
  },
];

/** Coerce an untrusted value (e.g. from the DB / JWT) into valid RoleIds. */
export function normalizeRoles(roles: unknown): RoleId[] {
  if (!Array.isArray(roles)) return [];
  return roles.filter(
    (r): r is RoleId => Number.isInteger(r) && r >= 1 && r <= 6,
  );
}

/**
 * Roles with COMPLETE app access — the owner/admin superuser. They may enter
 * EVERY section/dashboard AND operate (write) within their HOME outlet. RLS
 * still forbids any cross-outlet write (current_writable_location_ids = home),
 * so this widens reach WITHIN the home tenant, never across tenants. This
 * intentionally lets a pure Owner write at home (the "owner/admin = full access"
 * product decision); cross-outlet operational roles 2/3/4/5 are unchanged.
 */
export const FULL_ACCESS_ROLES: RoleId[] = [ROLES.ADMIN, ROLES.OWNER];
export const hasFullAccess = (roles: RoleId[]): boolean =>
  roles.some((r) => FULL_ACCESS_ROLES.includes(r));

/** The section a user naturally "lives" in (privilege order), by roles held. */
function primarySection(roles: RoleId[]): SectionDef | undefined {
  return SECTIONS.find((s) => s.roles.some((r) => roles.includes(r)));
}

/** Sections the given roles are allowed to enter, in privilege order. */
export function accessibleSections(roles: RoleId[]): SectionDef[] {
  if (hasFullAccess(roles)) return SECTIONS;
  return SECTIONS.filter((s) => s.roles.some((r) => roles.includes(r)));
}

/** Extract the dashboard section a pathname belongs to, if any. */
export function sectionFromPath(pathname: string): Section | null {
  const match = pathname.match(
    /^\/dashboard\/(portfolio|admin|manager|store|kitchen)(?:\/|$)/,
  );
  return (match?.[1] as Section) ?? null;
}

export function rolesCanAccessSection(
  roles: RoleId[],
  section: Section,
): boolean {
  if (hasFullAccess(roles)) return true;
  return SECTION_BY_KEY[section].roles.some((r) => roles.includes(r));
}

/** Where to send a user after login / from the bare `/dashboard` route. */
export function homeRouteForRoles(roles: RoleId[]): string {
  // Full-access users still land on their NATURAL home (admin → console,
  // owner → portfolio), not merely the first section in the list.
  const home = primarySection(roles) ?? accessibleSections(roles)[0];
  return home ? home.href : "/dashboard/no-access";
}
