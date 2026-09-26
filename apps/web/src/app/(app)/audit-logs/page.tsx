import { redirect } from 'next/navigation';

export default function LegacyAuditLogs() {
  redirect('/administration/audit-logs');
}
