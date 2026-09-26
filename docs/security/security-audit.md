# Phase 6C Security Audit

Date: 2026-09-20  
Scope: Single-organization medicine distribution system (Phases 1–6B)  
Method: Code review of authentication, authorization, validation, exports, workers, and configuration

Severity scale: CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Summary

| Severity | Count (pre-fix) | Count (post-fix) |
|----------|-------------------|---------------------|
| CRITICAL | 0 | 0 |
| HIGH | 5 | 0 (remediated) |
| MEDIUM | 8 | 0–2 residual (documented) |
| LOW | 6 | residual notes below |
| INFO | 4 | documented |

---

## Findings

### H1 — Sibling password-reset tokens remain valid
- **Severity:** HIGH
- **Area:** Authentication / password reset
- **Evidence:** `apps/api/src/modules/auth/auth.service.ts` (`resetPassword` marked only the consumed token)
- **Remediation:** Invalidate all unused reset tokens for the user in the same transaction
- **Test coverage:** `security-hardening.spec.ts` (reset invalidates siblings)
- **Status:** Fixed

### H2 — Refresh token reuse not treated as compromise
- **Severity:** HIGH
- **Area:** Refresh tokens
- **Evidence:** `auth.service.ts` `refresh()` ignored revoked hashes
- **Remediation:** On presentation of a revoked refresh hash, revoke all active sessions for that user and reject
- **Test coverage:** Refresh A → B → A rejected + sessions revoked
- **Status:** Fixed

### H3 — Legacy pharmacy report IDOR
- **Severity:** HIGH
- **Area:** Reports
- **Evidence:** `reports.controller.ts` `GET reports/pharmacy` passed client `pharmacyId` without `scopedPharmacyId`
- **Remediation:** Scope via `scopedPharmacyId(user, pharmacyId)`
- **Test coverage:** Pharmacy isolation unit + security suite
- **Status:** Fixed

### H4 — Stock movements lack pharmacy/warehouse scoping
- **Severity:** HIGH
- **Area:** Stock movements API
- **Evidence:** `stock-movements.controller.ts` / `.service.ts` listed without user context
- **Remediation:** Pass authenticated user; pharmacy-assigned users forced to their pharmacy movements only
- **Test coverage:** Security suite IDOR cases
- **Status:** Fixed

### H5 — Pharmacy managers could manage users without pharmacy assignment
- **Severity:** HIGH
- **Area:** Users
- **Evidence:** `users.service.ts` `assertCanManageUser` skipped when target `pharmacyId` was null
- **Remediation:** Pharmacy actors may only manage users assigned to the same pharmacy
- **Test coverage:** Security suite
- **Status:** Fixed

### M1 — Missing tight rate limits on refresh / reset / invitations / alert evaluate
- **Severity:** MEDIUM
- **Area:** Rate limiting
- **Evidence:** Only login + forgot-password had `@Throttle`
- **Remediation:** Added throttles on refresh, reset-password, invitation preview/accept, manual evaluate
- **Status:** Fixed

### M2 — Login timing side-channel (enumeration)
- **Severity:** MEDIUM
- **Area:** Authentication
- **Evidence:** Argon2 verify skipped when user missing
- **Remediation:** Dummy Argon2id verify on missing/non-authenticatable users
- **Status:** Fixed

### M3 — JWT missing algorithm / issuer / audience pinning
- **Severity:** MEDIUM
- **Area:** JWT
- **Evidence:** `jwt.strategy.ts`, `auth.module.ts`
- **Remediation:** HS256 + issuer/audience on sign and verify
- **Status:** Fixed

### M4 — Settings mass assignment
- **Severity:** MEDIUM
- **Area:** Settings
- **Evidence:** `settings.controller.ts` accepted `Record<string, unknown>`
- **Remediation:** Whitelisted `UpdateSettingsDto`
- **Status:** Fixed

### M5 — CSV/XLSX formula injection
- **Severity:** MEDIUM
- **Area:** Report exports
- **Evidence:** `csv.exporter.ts`, `excel.exporter.ts`
- **Remediation:** Neutralize leading `= + - @` / tab / CR
- **Status:** Fixed

### M6 — No request correlation ID
- **Severity:** MEDIUM
- **Area:** Observability / error handling
- **Evidence:** No middleware; filter lacked request id
- **Remediation:** `X-Request-Id` middleware + filter/response inclusion
- **Status:** Fixed

### M7 — Weak production environment validation
- **Severity:** MEDIUM
- **Area:** Configuration
- **Evidence:** `configuration.ts` only required presence of JWT secrets
- **Remediation:** Production fail-fast for weak/placeholder secrets, CORS `*`, missing `WEB_ORIGIN` / `REDIS_URL`
- **Status:** Fixed

### M8 — Audit logs mutable at database level
- **Severity:** MEDIUM
- **Area:** Audit integrity
- **Evidence:** App code append-only; no DB triggers
- **Remediation:** Migration `20260319100000_security_hardening` adds BEFORE UPDATE/DELETE triggers
- **Status:** Fixed

### L1 — Pharmacy PATCH allowed `code` / `isActive` via DTO shape
- **Severity:** LOW
- **Area:** Pharmacies
- **Remediation:** Dedicated `UpdatePharmacyDto` without code/status
- **Status:** Fixed

### L2 — Unbounded search / free-text length
- **Severity:** LOW
- **Area:** Input validation
- **Remediation:** `@MaxLength` on pagination search/sortBy; sortOrder `@IsIn`
- **Status:** Fixed

### L3 — Swagger enabled in all environments
- **Severity:** LOW
- **Area:** API surface exposure
- **Remediation:** Swagger only when `NODE_ENV !== 'production'`
- **Status:** Fixed

### L4 — Mailer logs full recipient email / token URLs in some paths
- **Severity:** LOW
- **Area:** Logging
- **Remediation:** Redact recipient in production logs; never log token URLs in production
- **Status:** Fixed

### L5 — Reset/invite email body previously omitted the secret link when SMTP “configured”
- **Severity:** LOW (functional/security overlap)
- **Area:** Mail content
- **Remediation:** Include one-time URL in email `text` body; still omit raw URL from production API responses
- **Status:** Fixed (no new email provider; content fix only)

### I1 — Beneficiaries are organization-global (no pharmacy FK)
- **Severity:** INFO
- **Area:** Beneficiaries
- **Evidence:** Schema has no `pharmacyId` on Beneficiary
- **Notes:** Shared registry by design for Phases 1–5. Dispensing remains pharmacy-scoped. Documented; not changed in 6C.
- **Status:** Accepted risk / product design

### I2 — Access JWT remains valid until expiry after logout
- **Severity:** INFO
- **Area:** Sessions
- **Notes:** Mitigated by short access TTL (15m) and ACTIVE-user reload on each request
- **Status:** Accepted

### I3 — `JWT_REFRESH_SECRET` unused (opaque refresh tokens)
- **Severity:** INFO
- **Area:** Configuration
- **Notes:** Still required so operators provision a strong secret; used as additional production entropy check. Opaque DB-backed refresh remains the design.
- **Status:** Documented

### I4 — Example env placeholders
- **Severity:** INFO
- **Area:** Secret management
- **Evidence:** `.env.example` uses `change-me-...` placeholders; real `.env` gitignored
- **Status:** No known issue found after review (placeholders only)

---

## Areas reviewed with no known issue after review

- Argon2id password hashing; hashes never returned in API user payloads
- Refresh / reset / invitation tokens stored as SHA-256 hashes only
- Global JwtAuthGuard + PermissionsGuard + ThrottlerGuard
- Core transfer / supply-request / dispensing / notification own-user isolation patterns
- Export authorization aligned with report permissions (modern endpoints)
- HttpExceptionFilter hides stacks/details in production
- Helmet enabled; CORS uses explicit `WEB_ORIGIN` (not `*` by default)
- Prisma `$queryRaw` usage is parameterized (no string-concat user SQL found)
- Alert worker runs fixed `evaluateAll` handler (no client identity in job payload)

---

## Residual risks

1. Shared beneficiary registry (I1) — cross-pharmacy PII by design unless a future tenancy phase changes it.
2. Redis must remain network-isolated and authenticated in production (documented in `production-environment.md`).
3. Dependency audit (`pnpm audit --prod`, 2026-09-20): **0 critical**, **6 high**, **3 moderate**, **1 low** in transitive deps — notably `multer` (via `@nestjs/platform-express`), `postcss` (via `next`), `deepmerge-ts` (via Prisma tooling). Not upgraded in Phase 6C to avoid unrelated breakage; monitor Nest/Next/Prisma releases. Application does not expose arbitrary multipart field-name attack surfaces beyond Nest defaults; Next postcss issues are build-time.
