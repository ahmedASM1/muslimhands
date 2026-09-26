import { redirect } from 'next/navigation';

export default function LegacyAdminPharmacies() {
  redirect('/administration/pharmacies');
}
