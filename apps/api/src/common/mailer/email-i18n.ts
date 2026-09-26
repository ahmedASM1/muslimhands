export type EmailLocale = 'en' | 'ar';

export function emailLocaleFromPreference(preferred?: string | null): EmailLocale {
  return preferred === 'AR' ? 'ar' : 'en';
}

type Copy = {
  hello: (name?: string) => string;
  invitation: {
    subject: string;
    title: string;
    summary: string;
    action: string;
    role: string;
    assignment: string;
    expires: string;
    pharmacyLogin: string;
    footer: string;
  };
  passwordReset: {
    subject: string;
    title: string;
    summary: string;
    action: string;
    footer: string;
  };
  notification: {
    action: string;
  };
  test: {
    subject: string;
    title: string;
    summary: string;
    footer: string;
  };
  brandSystem: string;
};

const EN: Copy = {
  hello: (name) => (name ? `Hello ${name},` : ''),
  invitation: {
    subject: "You're invited to the Muslim Hands Medicine Distribution System",
    title: "You're invited",
    summary:
      'You have been invited to join the Muslim Hands Medicine Distribution System. Use the button below to set your password and activate your account.',
    action: 'Accept Invitation',
    role: 'Role',
    assignment: 'Assignment',
    expires: 'Expires',
    pharmacyLogin: 'Pharmacy login',
    footer:
      'Do not share this invitation link. If you did not expect this invitation, you can safely ignore this email.',
  },
  passwordReset: {
    subject: 'Reset your Muslim Hands account password',
    title: 'Password reset request',
    summary: 'Use the link below to reset your password. This link expires in 1 hour.',
    action: 'Reset Password',
    footer:
      'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
  },
  notification: {
    action: 'View in system',
  },
  test: {
    subject: 'Muslim Hands — test email',
    title: 'Test email',
    summary:
      'This is a test email confirming that Resend delivery is configured for the Medicine Distribution System.',
    footer: 'You can safely ignore this message if you did not request it.',
  },
  brandSystem: 'Medicine Distribution System',
};

const AR: Copy = {
  hello: (name) => (name ? `مرحباً ${name}،` : ''),
  invitation: {
    subject: 'دعوة للانضمام إلى نظام مسلم هاندز لتوزيع الأدوية',
    title: 'تمت دعوتك',
    summary:
      'تمت دعوتك للانضمام إلى نظام مسلم هاندز لتوزيع الأدوية. استخدم الزر أدناه لتعيين كلمة المرور وتفعيل حسابك.',
    action: 'قبول الدعوة',
    role: 'الدور',
    assignment: 'التعيين',
    expires: 'تنتهي في',
    pharmacyLogin: 'دخول الصيدلية',
    footer: 'لا تشارك رابط الدعوة. إذا لم تتوقع هذه الدعوة يمكنك تجاهل هذا البريد بأمان.',
  },
  passwordReset: {
    subject: 'إعادة تعيين كلمة مرور حساب مسلم هاندز',
    title: 'طلب إعادة تعيين كلمة المرور',
    summary: "استخدم الرابط أدناه لإعادة تعيين كلمة المرور. ينتهي هذا الرابط خلال ساعة.",
    action: 'إعادة تعيين كلمة المرور',
    footer:
      'إذا لم تطلب إعادة تعيين كلمة المرور يمكنك تجاهل هذا البريد. ستبقى كلمة مرورك دون تغيير.',
  },
  notification: {
    action: 'عرض في النظام',
  },
  test: {
    subject: 'مسلم هاندز — بريد تجريبي',
    title: 'بريد تجريبي',
    summary: 'هذا بريد تجريبي للتأكد من إعداد إرسال Resend لنظام توزيع الأدوية.',
    footer: 'يمكنك تجاهل هذه الرسالة إذا لم تطلبها.',
  },
  brandSystem: 'نظام توزيع الأدوية',
};

export function emailCopy(locale: EmailLocale): Copy {
  return locale === 'ar' ? AR : EN;
}

/** Localized titles for operational notification emails by type. */
export function localizedNotificationCopy(
  locale: EmailLocale,
  type: string,
  fallbackTitle: string,
  fallbackMessage: string,
): { title: string; summary: string } {
  const map: Record<
    string,
    { en: { title: string; summary: string }; ar: { title: string; summary: string } }
  > = {
    LOW_STOCK: {
      en: { title: 'Low stock', summary: 'Stock is below the minimum level.' },
      ar: { title: 'انخفاض المخزون', summary: 'المخزون أقل من الحد الأدنى.' },
    },
    EXPIRING_SOON: {
      en: { title: 'Expiring soon', summary: 'Stock is approaching expiry.' },
      ar: { title: 'قريب الانتهاء', summary: 'المخزون يقترب من تاريخ انتهاء الصلاحية.' },
    },
    EXPIRED_STOCK: {
      en: { title: 'Expired stock', summary: 'Stock has passed its expiry date.' },
      ar: { title: 'مخزون منتهي الصلاحية', summary: 'تجاوز المخزون تاريخ انتهاء الصلاحية.' },
    },
    PENDING_SUPPLY_REQUEST: {
      en: { title: 'Pending supply request', summary: 'A supply request needs review.' },
      ar: { title: 'طلب توريد معلّق', summary: 'يوجد طلب توريد بحاجة للمراجعة.' },
    },
    TRANSFER_AWAITING_RECEIPT: {
      en: { title: 'Transfer awaiting receipt', summary: 'A transfer is waiting to be received.' },
      ar: { title: 'تحويل بانتظار الاستلام', summary: 'يوجد تحويل بانتظار الاستلام.' },
    },
    TRANSFER_SHIPPED: {
      en: { title: 'Transfer shipped', summary: 'A transfer has been shipped.' },
      ar: { title: 'تم شحن التحويل', summary: 'تم شحن تحويل مخزني.' },
    },
    TRANSFER_RECEIVED: {
      en: { title: 'Transfer received', summary: 'A transfer has been received.' },
      ar: { title: 'تم استلام التحويل', summary: 'تم استلام تحويل مخزني.' },
    },
    SUPPLY_REQUEST_APPROVED: {
      en: { title: 'Supply request approved', summary: 'A supply request was approved.' },
      ar: { title: 'تمت الموافقة على طلب التوريد', summary: 'تمت الموافقة على طلب توريد.' },
    },
    SUPPLY_REQUEST_REJECTED: {
      en: { title: 'Supply request rejected', summary: 'A supply request was rejected.' },
      ar: { title: 'رُفض طلب التوريد', summary: 'تم رفض طلب توريد.' },
    },
  };

  const entry = map[type];
  if (!entry) return { title: fallbackTitle, summary: fallbackMessage };
  return entry[locale];
}
