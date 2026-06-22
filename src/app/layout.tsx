import type { Metadata } from 'next';
import './fe-styles.css';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

export const metadata: Metadata = {
  title: 'LuxPower Local Monitor',
  description: 'Real-time LuxPower inverter monitoring — local mode via Modbus TCP',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body><I18nProvider>{children}</I18nProvider></body>
    </html>
  );
}
