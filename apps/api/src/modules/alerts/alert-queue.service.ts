import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { AlertEvaluationService } from './alert-evaluation.service';

export const ALERT_QUEUE_NAME = 'alert-evaluation';
export const ALERT_JOB_NAME = 'evaluate-alerts';

@Injectable()
export class AlertQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertQueueService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly evaluation: AlertEvaluationService,
  ) {}

  async onModuleInit() {
    try {
      const connection = this.connectionOptions();
      this.queue = new Queue(ALERT_QUEUE_NAME, { connection });
      this.worker = new Worker(
        ALERT_QUEUE_NAME,
        async (job: Job) => {
          this.logger.log(`Running alert evaluation job ${job.id}`);
          return this.evaluation.evaluateAll();
        },
        { connection, concurrency: 1 },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `Alert job ${job?.id} failed: ${error.message}`,
          error.stack,
        );
      });

      await this.queue.upsertJobScheduler(
        'alert-evaluation-hourly',
        { every: 60 * 60 * 1000 },
        {
          name: ALERT_JOB_NAME,
          data: {},
          opts: {
            removeOnComplete: 20,
            removeOnFail: 50,
          },
        },
      );

      await this.queue.add(
        ALERT_JOB_NAME,
        { reason: 'startup' },
        { removeOnComplete: true },
      );

      this.logger.log('Alert evaluation worker started (hourly)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Alert worker not started (Redis unavailable?): ${message}. Manual evaluate endpoint still works.`,
      );
    }
  }

  async enqueueNow(reason = 'manual') {
    if (!this.queue) {
      return this.evaluation.evaluateAll();
    }
    const job = await this.queue.add(
      ALERT_JOB_NAME,
      { reason },
      { removeOnComplete: true, removeOnFail: 10 },
    );
    return { jobId: job.id };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
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
