# API

The backend is a versioned REST API.

- Base path: `/api/v1`
- Swagger UI: `/api/docs`
- Auth: `Authorization: Bearer <access-token>`

Responses are wrapped:

```json
{
  "success": true,
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Errors:

```json
{
  "success": false,
  "error": {
    "code": "Unauthorized",
    "message": "Invalid credentials"
  }
}
```

## Implemented in Phase 1

| Method | Path                   | Access            | Notes                                   |
| ------ | ---------------------- | ----------------- | --------------------------------------- |
| GET    | `/api/v1/health`       | public            | Database and Redis checks               |
| POST   | `/api/v1/auth/login`   | public            | Returns user + tokens                   |
| POST   | `/api/v1/auth/refresh` | public            | Rotates refresh token                   |
| POST   | `/api/v1/auth/logout`  | authenticated     | Revokes refresh token, writes audit log |
| GET    | `/api/v1/auth/me`      | authenticated     | Current user, roles, permissions        |
| GET    | `/api/v1/users`        | `users:read`      | Paginated user list                     |
| GET    | `/api/v1/roles`        | `roles:read`      | Roles and permissions                   |
| GET    | `/api/v1/audit-logs`   | `audit-logs:read` | Paginated audit history                 |

## Reserved versioned prefixes

These modules are registered and documented in Swagger. Business endpoints will be added in later phases.

- `/api/v1/medicines`
- `/api/v1/categories`
- `/api/v1/batches`
- `/api/v1/units`
- `/api/v1/warehouses`
- `/api/v1/pharmacies`
- `/api/v1/warehouse-stock`
- `/api/v1/pharmacy-stock`
- `/api/v1/receipts`
- `/api/v1/supply-requests`
- `/api/v1/transfers`
- `/api/v1/dispensing`
- `/api/v1/beneficiaries`
- `/api/v1/stock-movements`
- `/api/v1/reports`
- `/api/v1/notifications`

## Pagination, filter, sort

List endpoints accept:

- `page` (default 1)
- `limit` (default 20, max 100)
- `search`
- `sortBy`
- `sortOrder` (`asc` | `desc`)

## Authorization

Guards run on the server:

1. `JwtAuthGuard` — unless the route is `@Public()`
2. `PermissionsGuard` — if `@RequirePermissions(...)` is present
3. `ThrottlerGuard` — request rate limit

Frontend hiding of menus is not sufficient.

## Tokens

- Access token: JWT, default 15 minutes
- Refresh token: opaque 48-byte secret, SHA-256 stored, default 7 days, rotated on use
