# Business rules

## Organizational model

The organization has a Central Warehouse and a Pharmacy. The warehouse supplies the pharmacy. The pharmacy distributes medicines free of charge.

There is no sales workflow.

## Inventory principle

Current stock is a projection. Stock movements are the history.

Every stock-changing operation must:

1. Verify sufficient quantity where stock is decreased
2. Lock the relevant stock row
3. Update current stock
4. Insert a `stock_movements` row in the same transaction
5. Write an audit log for significant actions
6. Commit only if all of the above succeed

Historical movement and audit rows must never be silently overwritten.

## Movement types

| Type                           | Typical effect                                          |
| ------------------------------ | ------------------------------------------------------- |
| RECEIPT                        | Warehouse quantity increases                            |
| TRANSFER_OUT                   | Warehouse quantity decreases when a transfer leaves     |
| TRANSFER_IN                    | Pharmacy quantity increases when a transfer is received |
| DISPENSE                       | Pharmacy quantity decreases                             |
| RETURN                         | Return into the appropriate location                    |
| ADJUSTMENT_IN / ADJUSTMENT_OUT | Manual correction                                       |
| DAMAGE                         | Quantity removed as damaged                             |
| EXPIRED                        | Quantity removed as expired                             |

## Medicines and batches

A medicine (for example Paracetamol 500mg) can have many batches. Each batch has a batch number, optional manufacturing date, expiry date, and quantity at each location.

Expired batches must never be automatically available for normal dispensing.

## FEFO

Dispensing should recommend the batch with the earliest valid expiry date that has available pharmacy stock (First Expire, First Out).

## Low stock

Each medicine has `minimum_stock` and `reorder_quantity`.

If current stock is below `minimum_stock`, the medicine is `LOW_STOCK`. The pharmacy may create a supply request. Stock is never transferred automatically.

## Supply requests

Statuses: DRAFT → SUBMITTED → APPROVED → transfer → FULFILLED.

Also: PARTIALLY_FULFILLED, REJECTED, CANCELLED.

Human approval is required. Partial fulfillment is allowed (requested 1000, transferred 700, remaining 300).

## Stock transfers

Internal warehouse → pharmacy movement is a **stock transfer**, not an invoice.

Statuses: DRAFT, PREPARED, IN_TRANSIT, RECEIVED, PARTIALLY_RECEIVED, CANCELLED.

A printable transfer document will be added later.

Warehouse stock decreases when the transfer is issued (`TRANSFER_OUT`). Pharmacy stock increases only when the pharmacy receives it (`TRANSFER_IN`).

## Dispensing

Dispensing is not checkout. A dispensing record captures medicine, batch, quantity, optional beneficiary, timestamp, and staff member. There is no payment, cash, tax, or sales invoice.

## Beneficiaries

Tracking is optional. Collect only minimal fields: number, name, gender, date of birth, phone, notes, active status.

## Roles

- SUPER_ADMIN
- WAREHOUSE_MANAGER
- WAREHOUSE_STAFF
- PHARMACY_MANAGER
- PHARMACY_STAFF
- REPORT_VIEWER

Permissions are granular by resource and action. Backend enforcement is mandatory.

## Audited actions

Create/update medicine, receipt create/post, supply request create/approve/reject, transfer create/receive, dispense, stock adjustment, mark damaged/expired, login/logout, user create/update.
