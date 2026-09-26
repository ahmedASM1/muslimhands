import { redirect } from 'next/navigation';

export default function LegacyAdminSettings() {
  redirect('/administration/settings');
}
