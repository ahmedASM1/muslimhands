import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailLogStatus } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import {
  renderEmailHtml,
  renderEmailText,
  type EmailTemplateId,
  type EmailTemplatePayload,
} from './email-templates';
import { ResendProvider } from './resend.provider';

export const EMAIL_QUEUE_NAME = 'email-notifications';
export const EMAIL_JOB_NAME = 'send-email';

export interface EmailJobData {
  emailLogId: string;
  type: string;
  template: EmailTemplateId;
  to: string;
  subject: string;
  payload: EmailTemplatePayload;
  notificationId?: string;
  userId?: string;
  developmentLink?: string;
}

@Injectable()
export class EmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueService.name);
  private queue: Queue<EmailJobData> | null = null;
  private worker: Worker<EmailJobData> | null = null;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly resend: ResendProvider,
  ) {}

  async onModuleInit() {
    try {
      const connection = this.connectionOptions();
      this.queue = new Queue(EMAIL_QUEUE_NAME, { connection });
      this.worker = new Worker(
        EMAIL_QUEUE_NAME,
        async (job: Job<EmailJobData>) => this.processJob(job),
        {
          connection,
          concurrency: 3,
        },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(`Email job ${job?.id} failed: ${error.message}`, error.stack);
      });

      this.logger.log('Email notification worker started');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Email worker not started (Redis unavailable?): ${message}. Emails will attempt inline fallback.`,
      );
    }
  }

  async enqueue(data: Omit<EmailJobData, 'emailLogId'> & { emailLogId?: string }) {
    const emailLog = data.emailLogId
      ? await this.prisma.emailLog.findUniqueOrThrow({ where: { id: data.emailLogId } })
      : await this.prisma.emailLog.create({
          data: {
            type: data.type,
            recipient: data.to,
            subject: data.subject,
            status: EmailLogStatus.QUEUED,
            provider: this.resend.isConfigured() ? 'RESEND' : 'DEVELOPMENT',
            notificationId: data.notificationId,
            userId: data.userId,
          },
        });

    const jobData: EmailJobData = {
      ...data,
      emailLogId: emailLog.id,
    };

    if (!this.queue) {
      await this.processJob({ data: jobData } as Job<EmailJobData>);
      return { emailLogId: emailLog.id, queued: false };
    }

    await this.queue.add(EMAIL_JOB_NAME, jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: data.notificationId ? `notification:${data.notificationId}` : undefined,
    });

    return { emailLogId: emailLog.id, queued: true };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async processJob(job: Job<EmailJobData>) {
    const { emailLogId, template, payload, to, subject, developmentLink } = job.data;
    const html = renderEmailHtml(template, payload);
    const text = renderEmailText(payload);

    try {
      const result = await this.resend.send({ to, subject, html, text });

      if (result.loggedOnly) {
        const nodeEnv = this.config.get('nodeEnv', { infer: true });
        if (nodeEnv !== 'production' && developmentLink) {
          this.logger.log(`[dev mail] ${subject} link available for recipient`);
        }
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: {
            status: EmailLogStatus.SENT,
            provider: 'DEVELOPMENT',
            sentAt: new Date(),
            messageId: `dev-${emailLogId}`,
          },
        });
        return { ok: true, development: true };
      }

      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: EmailLogStatus.SENT,
          provider: result.provider,
          messageId: result.messageId,
          sentAt: new Date(),
          failedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      return { ok: true, messageId: result.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: EmailLogStatus.FAILED,
          failedAt: new Date(),
          errorMessage: message.slice(0, 500),
        },
      });
      throw error;
    }
  }

  private connectionOptions() {
    const redisUrl = this.config.get('redisUrl', { infer: true });
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      maxRetriesPerRequest: null as null,
    };
  }
}
