import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadConfiguration } from './config/configuration';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MailerModule } from './common/mailer/mailer.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RedisModule } from './common/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BatchesModule } from './modules/batches/batches.module';
import { BeneficiariesModule } from './modules/beneficiaries/beneficiaries.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DispensingModule } from './modules/dispensing/dispensing.module';
import { HealthModule } from './modules/health/health.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PharmaciesModule } from './modules/pharmacies/pharmacies.module';
import { PharmacyStockModule } from './modules/pharmacy-stock/pharmacy-stock.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { StockMovementsModule } from './modules/stock-movements/stock-movements.module';
import { SupplyRequestsModule } from './modules/supply-requests/supply-requests.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { UnitsModule } from './modules/units/units.module';
import { UsersModule } from './modules/users/users.module';
import { WarehouseStockModule } from './modules/warehouse-stock/warehouse-stock.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { InventoryModule } from './common/inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      load: [loadConfiguration],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
    }),
    PrismaModule,
    InventoryModule,
    MailerModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    MedicinesModule,
    CategoriesModule,
    BatchesModule,
    UnitsModule,
    WarehousesModule,
    WarehouseStockModule,
    OrganizationsModule,
    PharmaciesModule,
    PharmacyStockModule,
    ReceiptsModule,
    SupplyRequestsModule,
    TransfersModule,
    DispensingModule,
    BeneficiariesModule,
    StockMovementsModule,
    ReportsModule,
    NotificationsModule,
    AlertsModule,
    AuditModule,
    InvitationsModule,
    DashboardModule,
    SettingsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
