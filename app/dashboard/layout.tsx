/**
 * Dashboard shell — access is enforced in middleware via session cookie.
 * (Server-side domain checks removed; shared Likewize credentials only.)
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
