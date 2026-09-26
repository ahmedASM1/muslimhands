# Medicine Distribution & Inventory Management

Production-oriented system for a Central Warehouse that supplies pharmacies, which then dispense medicines **free of charge** to beneficiaries.

This is not a commercial pharmacy POS. There is no checkout, cash, tax, or beneficiary invoice. Optional reference/cost values exist only so management can calculate **estimated value** of distributed medicines.

## Current status

The application is a working modular monolith:

- pnpm + Turborepo
- NestJS API (`/api/v1`) with Swagger
- Next.js App Router + Tailwind + shadcn/ui
- PostgreSQL + Prisma (current stock + immutable stock movements)
- JWT access tokens, hashed refresh tokens, Argon2id, RBAC (role + permission + pharmacy/warehouse context)
- Invitation workflow (hashed tokens, development invite links)
- Warehouse receipts, transfers, pharmacy dispensing (FEFO), reports, audit logs

## Requirements

- Node.js 20+
- pnpm 10
- Docker and Docker Compose

## Project structure

```
apps/api            NestJS + Prisma
apps/web            Next.js + Tailwind + shadcn/ui
packages/shared     Shared enums, permissions, types
docs/               Architecture and domain docs
docker-compose.yml  PostgreSQL + Redis
```

## Local setup

```bash
# 1. Copy environment file
# PowerShell:
Copy-Item .env.example .env

# 2. Start PostgreSQL and Redis
docker compose up -d

# 3. Install dependencies
pnpm install

# 4. Generate Prisma client, run migrations, seed demo data
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Start API and web
pnpm dev
```

If `pnpm` is not recognized in PowerShell:

```powershell
npm run dev
# or:
& "$env:APPDATA\npm\pnpm.cmd" dev
```

Local Docker maps PostgreSQL to `55432` and Redis to `56379` so they do not collide with other stacks on this machine.

## Default local URLs

- Web: http://localhost:3000
- API: http://localhost:3001/api/v1
- Health: http://localhost:3001/api/v1/health
- Swagger: http://localhost:3001/api/docs
- Pharmacies: http://localhost:3000/pharmacies/al-amal and http://localhost:3000/pharmacies/al-noor

## Development accounts

These exist only after `pnpm db:seed`. They are **local development credentials**, not production accounts.

Password for all seeded users: value of `SEED_ADMIN_PASSWORD` in `.env` (default `ChangeMeNow!`)

| Role | Name | Email |
| --- | --- | --- |
| Super Admin | System Administrator | `admin@localhost.local` |
| Warehouse Manager | Ali Hassan | `warehouse.manager@localhost.local` |
| Warehouse Staff | Omar Saleh | `warehouse.staff1@localhost.local` |
| Pharmacy Manager (Al-Amal / PHA-001) | Ahmed Al-Amal | `amal.manager@localhost.local` |
| Pharmacy Staff (Al-Amal / PHA-001) | Mohammed Nabil | `amal.staff1@localhost.local` |
| Pharmacy Staff (Al-Amal / PHA-001) | Sara Karim | `amal.staff2@localhost.local` |
| Pharmacy Manager (Al-Noor / PHA-002) | Mona Al-Noor | `noor.manager@localhost.local` |
| Pharmacy Staff (Al-Noor / PHA-002) | Khaled Noor | `noor.staff1@localhost.local` |
| Report Viewer | Rami Viewer | `reports.viewer@localhost.local` |

Invitation emails are logged by the API in development, including the accept URL. Password-reset links are also logged/returned in non-production.

## Useful commands

| Command            | Purpose                |
| ------------------ | ---------------------- |
| `pnpm dev`         | Run API and web        |
| `pnpm build`       | Production build       |
| `pnpm lint`        | Lint all packages      |
| `pnpm typecheck`   | TypeScript checks      |
| `pnpm test`        | Unit tests             |
| `pnpm format`      | Prettier               |
| `pnpm db:validate` | Validate Prisma schema |
| `pnpm db:studio`   | Prisma Studio          |

## Documentation

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [API](docs/api.md)
- [Business rules](docs/business-rules.md)

## Security notes

- Do not commit `.env`
- Replace JWT secrets before any shared environment
- Authorization is enforced in the API, not only the UI
- Stock history and audit logs are immutable
- Invitation and password-reset tokens are stored as hashes only
