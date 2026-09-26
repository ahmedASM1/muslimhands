import { Global, Module } from '@nestjs/common';
import { EmailQueueService } from './email-queue.service';
import { MailerService } from './mailer.service';
import { ResendProvider } from './resend.provider';

@Global()
@Module({
  providers: [ResendProvider, EmailQueueService, MailerService],
  exports: [MailerService, EmailQueueService, ResendProvider],
})
export class MailerModule {}
