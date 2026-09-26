import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { ToastProvider } from '@/lib/toast';
import { QueryProvider } from '@/providers/query-provider';
import { LocaleProvider } from '@/i18n/locale-context';
import { localeBootScript } from '@/i18n/boot';
import './globals.css';

const cairo = Cairo({
  subsets: ['latin', 'arabic'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Medicine Distribution System',
  description: 'Warehouse and pharmacy inventory for free medicine distribution',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootScript() }} />
      </head>
      <body className={`${cairo.variable} font-sans antialiased`}>
        <QueryProvider>
          <LocaleProvider>
            <AuthProvider>
              <ToastProvider>{children}</ToastProvider>
            </AuthProvider>
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
