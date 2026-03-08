import type { Metadata } from 'next';
import DashboardPageClient from './DashboardPageClient';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function DashboardPage() {
  return <DashboardPageClient />;
}
