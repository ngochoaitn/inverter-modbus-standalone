import type { Metadata } from 'next';
import './fe-styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'LuxPower Local Monitor',
  description: 'Real-time LuxPower inverter monitoring — local mode via Modbus TCP',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
