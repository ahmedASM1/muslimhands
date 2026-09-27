import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WarehouseStockController } from './warehouse-stock.controller';
import { WarehouseStockService } from './warehouse-stock.service';

@Module({
  imports: [SettingsModule],
  controllers: [WarehouseStockController],
  providers: [WarehouseStockService],
  exports: [WarehouseStockService],
})
export class WarehouseStockModule {}
