export type EmailTemplateId =
  | 'invitation'
  | 'password-reset'
  | 'low-stock'
  | 'expiring-stock'
  | 'expired-stock'
  | 'pending-supply-request'
  | 'transfer-awaiting-receipt'
  | 'transfer-shipped'
  | 'transfer-received'
  | 'supply-request-approved'
  | 'supply-request-rejected'
  | 'generic-notification';

export interface EmailTemplatePayload {
  recipientName?: string;
  title: string;
  summary: string;
  actionUrl?: string;
  actionLabel?: string;
  meta?: Array<{ label: string; value: string }>;
  footerNote?: string;
  locale?: 'en' | 'ar';
}

const BRAND = {
  name: 'Muslim Hands Medicine Distribution System',
  primary: '#008DB5',
  deep: '#006F91',
  bg: '#F5F9FC',
  text: '#12304A',
  muted: '#64748B',
};

export function renderEmailHtml(template: EmailTemplateId, payload: EmailTemplatePayload): string {
  const locale = payload.locale === 'ar' ? 'ar' : 'en';
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const hello =
    payload.recipientName
      ? locale === 'ar'
        ? `مرحباً ${escapeHtml(payload.recipientName)}،`
        : `Hello ${escapeHtml(payload.recipientName)},`
      : '';
  const rows =
    payload.meta
      ?.map(
        (item) =>
          `<tr><td style="padding:4px 0;color:${BRAND.muted};font-size:13px;width:140px;">${escapeHtml(item.label)}</td><td style="padding:4px 0;color:${BRAND.text};font-size:13px;font-weight:600;">${escapeHtml(item.value)}</td></tr>`,
      )
      .join('') ?? '';

  const orOpen = locale === 'ar' ? 'أو افتح:' : 'Or open:';
  const action = payload.actionUrl
    ? `<p style="margin:28px 0 12px;"><a href="${escapeHtml(payload.actionUrl)}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${escapeHtml(payload.actionLabel ?? 'Open')}</a></p>
       <p style="margin:0;color:${BRAND.muted};font-size:12px;word-break:break-all;">${orOpen} ${escapeHtml(payload.actionUrl)}</p>`
    : '';

  const systemLabel = locale === 'ar' ? 'نظام توزيع الأدوية' : 'Medicine Distribution System';
  const brandName =
    locale === 'ar' ? 'نظام مسلم هاندز لتوزيع الأدوية' : BRAND.name;
  const defaultFooter =
    locale === 'ar'
      ? 'إذا لم تتوقع هذه الرسالة يمكنك تجاهلها بأمان.'
      : 'If you did not expect this message, you can safely ignore it.';

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8" /><title>${escapeHtml(payload.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Cairo,Segoe UI,Tahoma,sans-serif;color:${BRAND.text};direction:${dir};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
        <tr><td style="background:linear-gradient(135deg,${BRAND.deep},${BRAND.primary});padding:20px 24px;color:#fff;text-align:${locale === 'ar' ? 'right' : 'left'};">
          <div style="font-size:18px;font-weight:700;">${locale === 'ar' ? 'مسلم هاندز' : 'Muslim Hands'}</div>
          <div style="font-size:12px;opacity:.9;margin-top:4px;">${systemLabel}</div>
        </td></tr>
        <tr><td style="padding:28px 24px;text-align:${locale === 'ar' ? 'right' : 'left'};">
          ${hello ? `<p style="margin:0 0 12px;font-size:15px;">${hello}</p>` : ''}
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(payload.title)}</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(payload.summary)}</p>
          ${rows ? `<table role="presentation" width="100%" style="margin:8px 0 4px;">${rows}</table>` : ''}
          ${action}
          <p style="margin:24px 0 0;font-size:12px;color:${BRAND.muted};">${escapeHtml(payload.footerNote ?? defaultFooter)}</p>
        </td></tr>
        <tr><td style="padding:14px 24px;background:#F8FAFC;color:${BRAND.muted};font-size:11px;text-align:${locale === 'ar' ? 'right' : 'left'};">
          ${escapeHtml(brandName)} · ${new Date().toUTCString()}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderEmailText(payload: EmailTemplatePayload): string {
  const meta = payload.meta?.map((m) => `${m.label}: ${m.value}`).join('\n') ?? '';
  return [
    payload.recipientName ? `Hello ${payload.recipientName},` : null,
    payload.title,
    '',
    payload.summary,
    meta ? `\n${meta}` : null,
    payload.actionUrl ? `\n${payload.actionLabel ?? 'Open'}: ${payload.actionUrl}` : null,
    '',
    payload.footerNote ?? 'If you did not expect this message, you can safely ignore it.',
  ]
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function templateForNotificationType(type: string): EmailTemplateId {
  switch (type) {
    case 'LOW_STOCK':
    case 'OUT_OF_STOCK':
      return 'low-stock';
    case 'EXPIRING_SOON':
    case 'EXPIRY_WARNING':
      return 'expiring-stock';
    case 'EXPIRED_STOCK':
    case 'EXPIRED_BATCH':
      return 'expired-stock';
    case 'PENDING_SUPPLY_REQUEST':
    case 'SUPPLY_REQUEST_SUBMITTED':
      return 'pending-supply-request';
    case 'SUPPLY_REQUEST_APPROVED':
      return 'supply-request-approved';
    case 'SUPPLY_REQUEST_REJECTED':
      return 'supply-request-rejected';
    case 'TRANSFER_AWAITING_RECEIPT':
      return 'transfer-awaiting-receipt';
    case 'TRANSFER_SHIPPED':
    case 'TRANSFER_CREATED':
      return 'transfer-shipped';
    case 'TRANSFER_RECEIVED':
      return 'transfer-received';
    default:
      return 'generic-notification';
  }
}

export const EMAILABLE_NOTIFICATION_TYPES = new Set([
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'EXPIRING_SOON',
  'EXPIRY_WARNING',
  'EXPIRED_STOCK',
  'EXPIRED_BATCH',
  'PENDING_SUPPLY_REQUEST',
  'SUPPLY_REQUEST_SUBMITTED',
  'SUPPLY_REQUEST_APPROVED',
  'SUPPLY_REQUEST_REJECTED',
  'TRANSFER_AWAITING_RECEIPT',
  'TRANSFER_SHIPPED',
  'TRANSFER_CREATED',
  'TRANSFER_RECEIVED',
]);
