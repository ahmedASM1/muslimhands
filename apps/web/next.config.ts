import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async redirects() {
    return [
      { source: '/admin/:path*', destination: '/administration/:path*', permanent: false },
      { source: '/audit-logs', destination: '/administration/audit-logs', permanent: false },
      { source: '/inventory/medicines', destination: '/administration/medicines', permanent: false },
      { source: '/inventory/categories', destination: '/administration/categories', permanent: false },
      { source: '/inventory/units', destination: '/administration/units', permanent: false },
      { source: '/inventory/batches', destination: '/administration/batches', permanent: false },
      { source: '/inventory/warehouse-stock', destination: '/warehouse/stock', permanent: false },
      { source: '/inventory/pharmacy-stock', destination: '/warehouse/pharmacy-stock', permanent: false },
      { source: '/warehouse/stock-movements', destination: '/warehouse/movements', permanent: false },
      { source: '/pharmacy/history', destination: '/pharmacy/dispensing-history', permanent: false },
      { source: '/beneficiaries', destination: '/pharmacy/beneficiaries', permanent: false },
    ];
  },
};

export default nextConfig;
