import type { Metadata } from 'next';
import { ServiceWorkerRegistration } from './service-worker-registration';
import './styles.css';

export const metadata: Metadata = {
  title: 'LifeOS',
  description: 'Open-source goals, projects, tasks, habits, and reviews.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
