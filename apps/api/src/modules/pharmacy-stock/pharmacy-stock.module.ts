import { Module } from '@nestjs/common';
import { PharmacyStockController } from './pharmacy-stock.controller';
import { PharmacyStockService } from './pharmacy-stock.service';

@Module({
  controllers: [PharmacyStockController],
  providers: [PharmacyStockService],
  exports: [PharmacyStockService],
})
export class PharmacyStockModule {}
