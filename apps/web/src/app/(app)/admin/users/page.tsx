import { redirect } from 'next/navigation';

export default function LegacyAdminUsers() {
  redirect('/administration/users');
}
