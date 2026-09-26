import { InvitationStatus } from '@mh/shared';
import { evaluateInvitation } from './invitation-rules';

describe('invitation acceptance rules', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('allows a pending unexpired invitation', () => {
    expect(evaluateInvitation({ status: InvitationStatus.PENDING, expiresAt: future })).toEqual({ ok: true });
  });

  it('rejects an expired invitation', () => {
    expect(evaluateInvitation({ status: InvitationStatus.PENDING, expiresAt: past })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects reuse of an accepted invitation', () => {
    expect(evaluateInvitation({ status: InvitationStatus.ACCEPTED, expiresAt: future })).toEqual({
      ok: false,
      reason: 'accepted',
    });
  });

  it('rejects a revoked invitation', () => {
    expect(evaluateInvitation({ status: InvitationStatus.REVOKED, expiresAt: future })).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });
});
