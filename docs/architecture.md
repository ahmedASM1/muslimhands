# Architecture

## System purpose

This application supports free medicine distribution for **one organization**. That organization operates a **Central Warehouse** and one or more **pharmacies**. The warehouse supplies the pharmacies. Pharmacies dispense medicines to beneficiaries at no charge.

This is not a multi-tenant SaaS platform. There is no tenant isolation, tenant billing, tenant switching, or pharmacy subdomain. Pharmacies are locations inside the same organization and are reached with normal application routes such as `/pharmacies/al-amal`.

This is not a commercial pharmacy POS. There is no payment, tax, or sales invoice flow. Internal warehouse-to-pharmacy movement is a **stock transfer**.

## Style

The system is a **modular monolith**.

- One NestJS API (`apps/api`)
- One Next.js web app (`apps/web`)
- Shared TypeScript contracts (`packages/shared`)
- One PostgreSQL database
- Redis reserved for BullMQ background jobs in a later phase

Do not split this into microservices.

## Repository layout

```
/
├── apps/api          NestJS REST API, Prisma, RBAC
├── apps/web          Next.js App Router UI
├── packages/shared   Enums, permission catalog, API types
├── docs              Architecture and domain documentation
└── docker-compose.yml
```

The workspace is a pnpm + Turborepo monorepo.

## Backend modules

Business logic lives in NestJS domain modules. Controllers stay thin. Services own use cases. Prisma is the data-access layer for Phase 1; dedicated repositories can be introduced when query complexity warrants it.

| Module            | Responsibility                         |
| ----------------- | -------------------------------------- |
| `auth`            | Login, logout, refresh, current user   |
| `users`           | User accounts                          |
| `roles`           | Roles and permission assignment        |
| `medicines`       | Medicine catalog                       |
| `categories`      | Medicine categories                    |
| `batches`         | Lots / expiry                          |
| `units`           | Units of measure                       |
| `warehouses`      | Warehouse locations                    |
| `warehouse-stock` | Current warehouse quantities           |
| `pharmacies`      | Pharmacy locations                     |
| `pharmacy-stock`  | Current pharmacy quantities            |
| `receipts`        | Inbound warehouse receipts             |
| `supply-requests` | Pharmacy requests and warehouse review |
| `transfers`       | Warehouse → pharmacy stock transfers   |
| `dispensing`      | Free-of-charge dispensing              |
| `beneficiaries`   | Optional beneficiary records           |
| `stock-movements` | Immutable inventory history            |
| `reports`         | Period reports and exports             |
| `notifications`   | In-app alerts                          |
| `audit`           | Immutable action log                   |

## Frontend organization

The web app is organized by domain routes that match operations:

- `/dashboard`, `/administration`, `/warehouse`, `/pharmacy`
- `/pharmacies/:slug` for a specific pharmacy in the same organization
- Reports, notifications, and audit logs
- Authorization in the UI is convenience only. The API enforces role + permission + assignment.

Authorization in the UI is convenience only. The API enforces RBAC on every protected route.

## Inventory consistency

Current stock tables are a projection. `stock_movements` is the audit history.

Every quantity change must:

1. Run inside a database transaction
2. Lock the relevant stock row
3. Update current stock
4. Insert an immutable movement in the same transaction

Never update or delete historical movement or audit rows.

## Authentication

- Access tokens: JWT (short-lived)
- Refresh tokens: opaque secrets stored as SHA-256 hashes
- Passwords: Argon2id
- Backend permission checks via guards

## Later phases

Phase 1 establishes structure, schema, auth, and documentation. Subsequent phases implement inventory workflows, FEFO dispensing, reporting exports, printable transfer documents, and background jobs.
