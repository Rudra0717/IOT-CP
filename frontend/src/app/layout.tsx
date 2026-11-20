import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EV Sense — Fleet Telemetry Platform',
  description: 'Real-time EV fleet monitoring and simulation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0e1a] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
