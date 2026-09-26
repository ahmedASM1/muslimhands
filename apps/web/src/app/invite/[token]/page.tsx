'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function InviteRedirectPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  useEffect(() => {
    if (token) {
      router.replace(`/accept-invitation?token=${encodeURIComponent(token)}`);
    }
  }, [token, router]);

  return <div className="p-8 text-sm text-muted-foreground">Opening invitation…</div>;
}
