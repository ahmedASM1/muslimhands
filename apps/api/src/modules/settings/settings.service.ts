import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { ResendProvider } from '../../common/mailer/resend.provider';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULTS = {
  expiryWarningDays: 90,
  organizationName: 'Medicine Distribution System',
};

const ALLOWED_KEYS = new Set(['expiryWarningDays', 'organizationName']);

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly resend: ResendProvider,
  ) {}

  async get() {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: [...ALLOWED_KEYS] } },
    });
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return { ...DEFAULTS, ...stored };
  }

  async getExpiryWarningDays(): Promise<number> {
    const settings = await this.get();
    const days = Number(settings.expiryWarningDays);
    return Number.isFinite(days) && days > 0 ? days : DEFAULTS.expiryWarningDays;
  }

  async update(values: { expiryWarningDays?: number; organizationName?: string }) {
    for (const [key, value] of Object.entries(values)) {
      if (!ALLOWED_KEYS.has(key) || value === undefined) {
        continue;
      }
      const jsonValue = value as Prisma.InputJsonValue;
      await this.prisma.appSetting.upsert({
        where: { key },
        update: { value: jsonValue },
        create: { key, value: jsonValue },
      });
    }
    return this.get();
  }

  async emailStatus() {
    const mail = this.config.get('mail', { infer: true });
    const configured = this.resend.isConfigured();
    const [lastSent, lastFailed] = await Promise.all([
      this.prisma.emailLog.findFirst({
        where: { status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true, type: true, recipient: true },
      }),
      this.prisma.emailLog.findFirst({
        where: { status: 'FAILED' },
        orderBy: { failedAt: 'desc' },
        select: { failedAt: true, type: true, errorCode: true },
      }),
    ]);

    return {
      provider: 'Resend',
      status: configured ? 'Connected' : 'Not configured',
      configured,
      from: mail.from,
      fromName: mail.fromName,
      replyTo: mail.replyTo ?? null,
      lastSuccessfulEmail: lastSent
        ? { at: lastSent.sentAt, type: lastSent.type }
        : null,
      lastFailure: lastFailed
        ? { at: lastFailed.failedAt, type: lastFailed.type, errorCode: lastFailed.errorCode }
        : null,
    };
  }
}
