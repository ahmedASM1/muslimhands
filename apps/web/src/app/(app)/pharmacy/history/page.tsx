import { redirect } from 'next/navigation';

export default function LegacyHistory() {
  redirect('/pharmacy/dispensing-history');
}
