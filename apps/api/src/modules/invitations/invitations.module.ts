import { Module } from '@nestjs/common';
import { PasswordService } from '../../common/crypto/password.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, PasswordService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
