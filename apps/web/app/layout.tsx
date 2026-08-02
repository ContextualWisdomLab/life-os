import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'LifeOS',
  description: 'Open-source goals, projects, tasks, habits, and reviews.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
