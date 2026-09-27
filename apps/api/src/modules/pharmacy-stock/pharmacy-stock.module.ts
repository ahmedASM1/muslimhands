import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PharmacyStockController } from './pharmacy-stock.controller';
import { PharmacyStockService } from './pharmacy-stock.service';

@Module({
  imports: [SettingsModule],
  controllers: [PharmacyStockController],
  providers: [PharmacyStockService],
  exports: [PharmacyStockService],
})
export class PharmacyStockModule {}
