import { InvitationStatus } from '@mh/shared';

export function evaluateInvitation(invitation: {
  status: string;
  expiresAt: Date;
}, now = new Date()): { ok: true } | { ok: false; reason: 'expired' | 'accepted' | 'revoked' | 'invalid' } {
  if (invitation.status === InvitationStatus.ACCEPTED) {
    return { ok: false, reason: 'accepted' };
  }
  if (invitation.status === InvitationStatus.REVOKED) {
    return { ok: false, reason: 'revoked' };
  }
  if (invitation.status === InvitationStatus.EXPIRED || invitation.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }
  if (invitation.status !== InvitationStatus.PENDING) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true };
}
