import { Module } from '@nestjs/common';
import {
  DispensingController,
  DispensingLegacyController,
} from './dispensing.controller';
import { DispensingService } from './dispensing.service';

@Module({
  controllers: [DispensingController, DispensingLegacyController],
  providers: [DispensingService],
  exports: [DispensingService],
})
export class DispensingModule {}
