import { EMAILABLE_NOTIFICATION_TYPES, templateForNotificationType } from './email-templates';

describe('email templates', () => {
  it('maps alert types to templates', () => {
    expect(templateForNotificationType('LOW_STOCK')).toBe('low-stock');
    expect(templateForNotificationType('EXPIRING_SOON')).toBe('expiring-stock');
    expect(templateForNotificationType('TRANSFER_AWAITING_RECEIPT')).toBe(
      'transfer-awaiting-receipt',
    );
  });

  it('marks operational alerts as emailable', () => {
    expect(EMAILABLE_NOTIFICATION_TYPES.has('LOW_STOCK')).toBe(true);
    expect(EMAILABLE_NOTIFICATION_TYPES.has('DISPENSING')).toBe(false);
  });
});
