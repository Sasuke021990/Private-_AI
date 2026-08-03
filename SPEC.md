# SPEC.MD: Authenticated Reverse Proxy Middleware & Admin Dashboard

## ✅ Confirmed Requirements & Scope
- **Core Functionality**: A middleware proxy server that authenticates an Admin (via hardcoded ENV variables) and End-Users (via PostgreSQL Database). Authorized traffic is routed to specific local ports based on dynamic URL paths.
- **Admin Dashboard**: A secure, server-rendered HTML/JS UI where the admin can view, add, edit, and delete proxy routes.
- **Desktop Client Integration**: A local Electron app establishes an SSH reverse tunnel to the VPS, mapping local apps to the proxy.
- **Hot-Reloading**: Changes to proxy routes made in the dashboard take effect instantly without restarting the server.
- **Storage**: Proxy routes and user data are both stored persistently in PostgreSQL via Prisma (`Route` and `User` models). An in-process `RouteManager` cache is refreshed from the DB on every mutation so routing stays hot-reloaded without a restart.
- **Location**: Deployed on the VPS via Docker Compose.

## 🛠 Tech Stack & Dependencies
- **Runtime**: Node.js, Docker
- **Language**: TypeScript
- **Web Framework**: Express
- **Database**: PostgreSQL (via Prisma ORM v7)
- **Core Libraries**: 
  - `http-proxy-middleware` (for proxying and WebSocket support)
  - `jsonwebtoken` (for issuing and verifying JWTs)
  - `cookie-parser` (to handle JWTs transparently in the browser)
  - `bcrypt` (for user password hashing)
  - `dotenv` (for loading environment variables)
- **Client App**: Electron, Node.js `ssh2` library, local TCP socket proxying.

## 📐 Architecture & Data Flow
```mermaid
sequenceDiagram
    participant EndUser as End User Browser
    participant Nginx as Nginx (VPS)
    participant AuthProxy as Auth Proxy (Node.js)
    participant SSHDaemon as sshd (VPS)
    participant ClientApp as Desktop Client App
    participant LocalMachine as Local App (e.g. Audio Studio)

    %% Desktop Client Connection Flow
    ClientApp->>AuthProxy: POST /api/login (Registers temporary SSH Public Key)
    ClientApp->>SSHDDaemon: Establish Reverse SSH Tunnel (Bind to 127.0.0.1:port)
    
    %% Proxy Flow
    EndUser->>Nginx: GET /vo
    Nginx->>AuthProxy: Forward GET /vo
    AuthProxy->>AuthProxy: Verify JWT Cookie
    AuthProxy->>AuthProxy: Read mapping for "/vo" -> http://127.0.0.1:port
    AuthProxy->>SSHDDaemon: Proxy HTTP/WS request over internal loopback
    SSHDDaemon->>ClientApp: Forward request via SSH Tunnel
    ClientApp->>LocalMachine: Forward request to local port
    LocalMachine-->>ClientApp: Return Response (allowHalfOpen stream)
    ClientApp-->>AuthProxy: Return Response via Tunnel
    AuthProxy-->>EndUser: Return Response
```

## 📁 File Structure & Module Breakdown
```
Private_AI/
├── .env                  # Admin Credentials & Database URL & Secrets (gitignored)
├── prisma/
│   └── schema.prisma     # PostgreSQL schema: User, Route, Log, RevokedToken
├── docker-compose.yml    # Orchestrates Auth Proxy & PostgreSQL
├── Dockerfile            # Container definition for the proxy
├── client-app/           # Desktop Client Application
│   ├── main.js           # SSH Tunneling logic
│   └── src/renderer.js   # Client UI
└── src/
    ├── index.ts          # Server entry point & global middlewares
    ├── config.ts         # Environment validation (fail-fast in production)
    ├── db.ts             # Prisma Client singleton
    ├── lib/
    │   ├── routeManager.ts       # In-memory cache backed by Prisma `Route` table; hot-reloads on every mutation
    │   ├── authz.ts               # Shared route-ownership check (canAccessRoute)
    │   ├── sshKeyManager.ts       # Validates, scopes, persists, and revokes per-route SSH authorized_keys entries
    │   └── revokedTokenManager.ts # In-memory JWT denylist (by jti), backed by the RevokedToken table
    ├── middleware/
    │   ├── auth.ts       # JWT verification, revocation check & login redirect logic
    │   ├── csrf.ts       # Double-submit-cookie CSRF check for browser-facing admin endpoints
    │   └── dynamicProxy.ts # Singleton proxy intercepting HTTP/WS traffic; enforces per-route ownership
    ├── routes/
    │   ├── admin.ts      # API endpoints for the dashboard (route CRUD, scoped to owner unless ADMIN)
    │   └── api.ts        # End-user authentication and SSH key registration
    └── views/
        ├── login.html    # Minimalist login UI
        ├── register.html # End-user registration UI
        └── dashboard.html # Dashboard UI to manage ports (renders all dynamic values via textContent, not innerHTML)
```

## 🔌 Configuration Schemas

**`.env` File** (gitignored; `docker-compose.yml` no longer hardcodes any secret — everything comes from here for both the `db` and `auth-proxy` services)
```env
PORT=4000
# NOTE: the Docker image bakes NODE_ENV=production by default (see Dockerfile), which makes
# auth cookies `secure`-only. If you are running `docker-compose up` locally WITHOUT a TLS
# reverse proxy in front, uncomment the next line to override it back to a non-production
# value so login still works over plain HTTP during local testing:
# NODE_ENV=development
JWT_SECRET=super_secret_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=securepassword
DATABASE_URL="postgresql://postgres:CHANGE_ME@127.0.0.1:5432/auth_proxy"
POSTGRES_USER=postgres          # must match the credentials embedded in DATABASE_URL
POSTGRES_PASSWORD=CHANGE_ME     # must match the credentials embedded in DATABASE_URL
POSTGRES_DB=auth_proxy          # must match the DB name embedded in DATABASE_URL
VPS_IP=203.57.85.144
```

## ⚠️ Critical Architecture Decisions & Edge Cases Resolved
1. **Dynamic Proxy Target Missing**: Handled by falling back to a dummy target (`http://127.0.0.1:65535`) and explicitly catching `ECONNREFUSED` on that port to return a clean 404 response.
2. **WebSocket Support (`upgrade` events)**: `http-proxy-middleware` cannot intercept WebSockets dynamically inside an Express route. The proxy is implemented as a Singleton and explicitly bound to `server.on('upgrade')`.
3. **Node.js Idle Timeouts**: Node.js defaults to a 5-second `keepAliveTimeout`. For long-running proxy requests (e.g., TTS Audio Generation), this caused random connection drops. Fixed by increasing server timeouts to 5 minutes (`300000ms`).
4. **URL Collision with Express Body Parser**: Mounting `express.json()` globally on `/api` caused it to consume the JSON bodies of proxied POST requests. Fixed by passing `express.json()` *only* to specific internal endpoints.
5. **TCP Half-Open Streams**: Node's TCP socket destroys itself upon receiving an EOF from the client HTTP request, cutting off the backend response. Fixed by enabling `allowHalfOpen: true` on the Desktop client's local socket proxy.
6. **Prisma v7 Deprecations**: The `--skip-generate` flag is removed in Prisma v7. Startup commands were updated to standard `prisma db push`.

## 🔒 Security Hardening (Commercialization Phase 1)
A full-repo audit ahead of commercial, multi-tenant use surfaced several exploitable gaps. These are being fixed in the order below; see `progress.md` for status of each phase.

1. **Stored XSS in the admin dashboard**: `dashboard.html` rendered user email and route path/target via unescaped `innerHTML`. Fixed by rebuilding table rows with `textContent`-based DOM construction.
2. **Cross-tenant route access with no ownership check**: any authenticated user could view (`GET /admin/api/routes`) or hit (via the proxy) another tenant's route. Fixed with a shared `canAccessRoute` helper (`src/lib/authz.ts`) enforced in the admin API, the HTTP proxy router, and — newly discovered — the WebSocket `upgrade` handler, which previously bypassed authentication entirely.
3. **Route ownership hijack via upsert**: adding a route with a path already owned by another user silently reassigned it. Fixed by checking existing ownership before upsert (409 on conflict).
4. **SSH tunnel isolation**: the restricted key issued on login used `permitopen="localhost:*"`, letting any tenant's tunnel reach any local port on the VPS, not just their own. Fixed by scoping `permitopen` to the specific port of the route being connected, and by moving key issuance from login-time to route-add-time (`src/lib/sshKeyManager.ts`) so the port is authoritative.
5. **Unbounded SSH key accumulation with no revocation**: keys were appended forever with no way to remove a departing/compromised user's access. Fixed by tracking each route's key on the `Route` row and regenerating `authorized_keys` from scratch (atomically) on route deletion and logout.
6. **SSH public key injection**: a malicious `publicKey` containing embedded newlines could smuggle an unrestricted second `authorized_keys` line. Fixed with strict validation (`sshpk` + control-character rejection) before use.
7. **Unrevocable JWTs**: a stolen token remained valid for its full 24h lifetime even after logout. Fixed with an in-memory revocation denylist keyed by `jti`, backed by a new `RevokedToken` table, checked in `requireAuth` with no per-request DB hit.
8. **CSRF**: cookie-authenticated state-changing admin endpoints had no CSRF protection. Fixed with a hand-rolled double-submit-cookie check (`src/middleware/csrf.ts`) plus `sameSite: 'lax'` on all auth cookies.
9. **Hardcoded secrets committed to `docker-compose.yml`**: `JWT_SECRET` and the Postgres password were checked into version control, and Compose's `environment:` block silently overrode the real value from `.env`. Fixed by removing the inline values and relying on `env_file`; the already-committed secret values must still be rotated by the user.
10. **Insecure config fallbacks**: `config.ts` silently fell back to `fallback_secret` / `admin`/`admin` if env vars were missing. Fixed to fail fast when `NODE_ENV=production`.
11. **No rate limiting**: `/login`, `/api/login`, and `/api/register` had no brute-force/spam protection. Fixed with `express-rate-limit`.

**Explicitly deferred** (multi-tenancy path namespacing, billing/plan tiers, email verification, audit logging, CI/tests, TLS-terminating reverse proxy infrastructure) — tracked separately, not part of this hardening pass. Note: `NODE_ENV=production` must not be deployed until a TLS-terminating reverse proxy is in front of the app, since it makes cookies `secure`-only.

## 💡 Implementation Status
Core functionality (Phases 1–6 above) is implemented and was verified working. Security Hardening (Commercialization Phase 1) is in progress per the list above — see `progress.md` for the current checklist.
