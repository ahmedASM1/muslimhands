import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { Resend } from 'resend';
import type { AppConfig } from '../../config/configuration';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  delivered: boolean;
  provider: 'RESEND' | 'DEVELOPMENT';
  messageId?: string;
  loggedOnly?: boolean;
}

@Injectable()
export class ResendProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private client: Resend | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const apiKey = this.config.get('mail.resendApiKey', { infer: true });
    if (apiKey) {
      this.client = new Resend(apiKey);
    }
  }

  isConfigured() {
    return Boolean(this.client);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const mail = this.config.get('mail', { infer: true });
    const from = mail.fromName ? `${mail.fromName} <${mail.from}>` : mail.from;
    const replyTo = input.replyTo ?? mail.replyTo;

    if (!this.client) {
      this.logger.warn(
        `Email provider: development mode (RESEND_API_KEY missing). Subject="${input.subject}"`,
      );
      return { delivered: false, provider: 'DEVELOPMENT', loggedOnly: true };
    }

    const { data, error } = await this.client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      const message = error.message || 'Resend send failed';
      const permanent =
        /only send testing emails|verify a domain|invalid.*from|not authorized/i.test(message);
      if (permanent) {
        throw new UnrecoverableError(message);
      }
      throw new Error(message);
    }

    return {
      delivered: true,
      provider: 'RESEND',
      messageId: data?.id,
    };
  }
}
