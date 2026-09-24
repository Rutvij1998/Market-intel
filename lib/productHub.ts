export const PRODUCT_HUB_ORIGIN =
  process.env.NEXT_PUBLIC_PRODUCT_HUB_ORIGIN || "http://127.0.0.1:4210";

export const PRODUCT_HUB_NAV = [
  { href: `${PRODUCT_HUB_ORIGIN}/`, label: "Home" },
  { href: `${PRODUCT_HUB_ORIGIN}/product-overview`, label: "Product Overview" },
  { href: `${PRODUCT_HUB_ORIGIN}/partner-overview`, label: "Partner Overview" },
  { href: `${PRODUCT_HUB_ORIGIN}/case-studies`, label: "Case Studies" },
  {
    href: `${PRODUCT_HUB_ORIGIN}/sales-enablement?view=responses`,
    label: "Sales Enablement",
  },
  { href: "/dashboard", label: "Market-Vantage", local: true },
] as const;

export const PRODUCT_HUB_RESOURCES = [
  {
    href: `${PRODUCT_HUB_ORIGIN}/catalog`,
    label: "Product Catalog",
    description: "Explore features and capabilities.",
  },
  {
    href: `${PRODUCT_HUB_ORIGIN}/api-catalog`,
    label: "Developers",
    description: "Find APIs and integration resources.",
  },
  {
    href: `${PRODUCT_HUB_ORIGIN}/technology-overview`,
    label: "Platforms",
    description: "Understand the technology behind our products.",
  },
  {
    href: `${PRODUCT_HUB_ORIGIN}/release-showcase`,
    label: "Changelog",
    description: "See changes and their release context.",
  },
] as const;
