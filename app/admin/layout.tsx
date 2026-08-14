import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin · Market Vantage',
  description: 'Configure Supabase data for Market Vantage',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
