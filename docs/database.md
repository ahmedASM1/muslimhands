# Database

PostgreSQL is the system of record. Prisma is the ORM. Primary keys are UUIDs. Timestamps are stored in UTC (`timestamptz`).

## Design rules

- Current stock is a cache of on-hand quantity (`warehouse_stock`, `pharmacy_stock`).
- `stock_movements` is append-only history.
- `audit_logs` is append-only.
- Medicine and batch are separate entities.
- Soft-delete (`deleted_at`) is used for catalog and identity records that should remain referencable.
- Unique constraints protect business numbers (SKU, barcode, receipt/transfer/request numbers).
- Indexes cover status, dates, medicine, batch, and location lookups.

## Entity groups

### Identity and access

- `users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`
- `refresh_tokens`

### Catalog

- `units`
- `medicine_categories`
- `medicines`
- `medicine_batches`

### Locations and current stock

- `warehouses`
- `pharmacies`
- `warehouse_stock` — unique on `(warehouse_id, batch_id)`
- `pharmacy_stock` — unique on `(pharmacy_id, batch_id)`

Quantity must never be negative. Application transactions enforce this; a database check constraint is added in the initial migration.

### Operational documents

- `stock_receipts` / `stock_receipt_items`
- `supply_requests` / `supply_request_items`
- `stock_transfers` / `stock_transfer_items`
- `dispensing_records` / `dispensing_items`
- `beneficiaries`

### History and operations

- `stock_movements` (no `updated_at`)
- `notifications`
- `audit_logs` (no `updated_at`)
- `app_settings`

## Important enums

- `SupplyRequestStatus`: DRAFT, SUBMITTED, APPROVED, PARTIALLY_FULFILLED, FULFILLED, REJECTED, CANCELLED
- `TransferStatus`: DRAFT, PREPARED, IN_TRANSIT, RECEIVED, PARTIALLY_RECEIVED, CANCELLED
- `MovementType`: RECEIPT, TRANSFER_OUT, TRANSFER_IN, DISPENSE, RETURN, ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGE, EXPIRED
- `LocationType`: WAREHOUSE, PHARMACY

## Stock movement shape

Each movement records:

- movement type
- location (warehouse or pharmacy)
- medicine and batch
- signed quantity
- balance after the change
- optional reference type/id
- reason
- actor
- occurred_at

`quantity` on a movement must not be zero.

## FEFO support

`medicine_batches.expiry_date` is indexed. Dispensing queries will select the earliest non-expired batch with available pharmacy quantity.

## Migrations

Schema lives in `apps/api/prisma/schema.prisma`.

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```
