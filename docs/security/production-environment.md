# Production Environment Requirements

This document lists **required** and **recommended** environment variables for deploying the Medicine Distribution API securely.

Do **not** put real secrets in this file. Values shown are examples / placeholders only.

---

## Required (API fails to start in `NODE_ENV=production` without safe values)

| Variable | Purpose | Production rules |
|----------|---------|------------------|
| `NODE_ENV` | Runtime mode | Must be `production` |
| `DATABASE_URL` | PostgreSQL connection | Required; use strong credentials; prefer TLS |
| `JWT_ACCESS_SECRET` | Access token HMAC key | Required; ≥ 32 characters; must not contain `change-me` |
| `JWT_REFRESH_SECRET` | Refresh-related secret / entropy | Required; ≥ 32 characters; must not contain `change-me`; distinct from access secret |
| `WEB_ORIGIN` | Browser CORS origin | Required; must be explicit HTTPS origin; must **not** be `*` |
| `REDIS_URL` | BullMQ / Redis | Required; prefer `redis://:password@host:port` or TLS URL |
| `APP_URL` | Absolute app URL for reset/invite links | Required recommended; defaults to `WEB_ORIGIN` if unset |

## Strongly recommended

| Variable | Purpose | Notes |
|----------|---------|-------|
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | Default `15m` — do not increase casually |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | Default `7d` |
| `API_HOST` / `API_PORT` | Bind address | Default `0.0.0.0:3001` behind reverse proxy |
| `MAIL_FROM` / `SMTP_*` | Outbound mail | If unset, reset/invite emails are not delivered (links still generated server-side) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Seed only | **Never** use default seed password in production; rotate immediately |

## CORS

- Development may use `http://localhost:3000`.
- Production **must** set `WEB_ORIGIN` to the real web origin (e.g. `https://inventory.example.org`).
- Credentials are enabled; `WEB_ORIGIN=*` is rejected at startup in production.

## Security headers

- API uses Helmet by default.
- Terminate TLS at the reverse proxy and enable HSTS there (`Strict-Transport-Security`).
- Swagger (`/api/docs`) is **disabled** when `NODE_ENV=production`.

## Redis / workers

- Isolate Redis from the public internet.
- Require AUTH (and TLS where available).
- Alert evaluation jobs are fixed-name and idempotent; do not expose Redis enqueue to untrusted networks.

## Database

- Apply all Prisma migrations including `20260319100000_security_hardening` (audit log immutability triggers).
- Application DB users should not bypass triggers via superuser for routine ops.

## Example (non-secret placeholders)

```bash
NODE_ENV=production
DATABASE_URL=postgresql://app_user:REPLACE_ME@db:5432/muslimhands?schema=public&sslmode=require
REDIS_URL=redis://:REPLACE_ME@redis:6379
WEB_ORIGIN=https://app.example.org
APP_URL=https://app.example.org
JWT_ACCESS_SECRET=REPLACE_WITH_LONG_RANDOM_STRING_AT_LEAST_32_CHARS
JWT_REFRESH_SECRET=REPLACE_WITH_DIFFERENT_LONG_RANDOM_STRING
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

## Startup validation

`loadConfiguration()` fails fast in production when:

- JWT secrets are missing, shorter than 32 characters, or match known placeholders
- `WEB_ORIGIN` is missing, empty, or `*`
- `REDIS_URL` is missing
- Access and refresh secrets are identical
