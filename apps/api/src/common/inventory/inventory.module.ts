import { Global, Module } from '@nestjs/common';
import { DispensingAllocationService } from './dispensing-allocation.service';
import { InventoryService } from './inventory.service';
import { InventoryTransactionService } from './inventory-transaction.service';

@Global()
@Module({
  providers: [InventoryService, InventoryTransactionService, DispensingAllocationService],
  exports: [InventoryService, InventoryTransactionService, DispensingAllocationService],
})
export class InventoryModule {}
