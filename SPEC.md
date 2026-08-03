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

## 🖥 Desktop Client Redesign (Completed)
The Electron client originally showed everything on one long scrolling form — login credentials, tunnel-creation fields, and the active-tunnel list all visible at once — and re-authenticated from scratch on every tunnel connect. Redesigned into:
- **Login view**: only email, password, and a Login button until authenticated.
- **App view**: left sidebar (Active Tunnels / Bind Tunnel / Settings) swapping content panels.
- **Session caching**: `login`/`logout` IPC handlers cache the session (cookie, CSRF token, VPS IP) in memory once instead of re-logging in per connect. Logout is local-only and deliberately does not tear down running tunnels.
- **Password no longer persisted**: `tunnel-config.json` keeps only email + settings; a migration strips the plaintext password from pre-existing config files.
- **`minimizeToTray`** is now a user setting rather than hardcoded behavior.
- **Path entry simplified**: the user types a bare segment (`voice`), the app prefixes `/`.

## 🎨 UI/UX Audit (Commercialization Phase 2 — Completed)
A line-by-line audit of both surfaces (`src/views/*.html` and `client-app/`) ahead of commercial use. Every item below was verified against the code, not assumed.

### Confirmed defects — broken or actively misleading
1. **Malformed HTML in `dashboard.html`** — verified 6 `<div>` opened vs 5 closed. The "Registered Users" card is nested *inside* the "Active Routes" card, and `.container` is never closed, causing visibly broken layout.
2. **Desktop "Active Tunnels" list is inaccurate after restart** — the list renders from `activeRoutes` persisted to disk, but the live-connection Map (`activeTunnels` in `main.js`) is only populated by a successful connect and is never repopulated at startup. Reopening the app shows tunnels as active when no SSH connection exists.
3. **Tray icon is invisible** — no `client-app/src/icon.png` exists, so the tray falls back to `nativeImage.createEmpty()`. With "minimize to tray" enabled the window hides with no clickable icon to restore it; the app appears to have vanished.
4. **Web dashboard fails silently** — the Add Route and Delete handlers never inspect the response. Server rejections (409 path taken, 403 CSRF, 400 validation) produce no user-visible feedback; the form simply resets.
5. **No tunnel auto-reconnect** — `CLIENT_SPEC.md` specifies reconnecting on `close`/`error` every 5 seconds. Verified never implemented; a transient network drop silently kills the tunnel.

### Usability gaps
6. **Public URL never surfaced in the desktop app** — the UI shows the path and local port but never the reachable URL (e.g. `http://<VPS_IP>:4000/voice`), and offers no copy-to-clipboard.
7. **No logout control in the web dashboard** — the `/logout` endpoint exists but is unreachable from the UI.
8. **"Disconnect" is destructive and unconfirmed** — it tears down the tunnel *and* deletes the server-side route. The web has a `confirm()` prompt; the desktop has none, so a single misclick is unrecoverable.
9. **"Registered Users (Admin Only)" renders for non-admins** — the endpoint 403s so the table stays empty, but the heading and empty table still render, appearing broken.
10. **No empty or loading states** in the web dashboard — tables render blank with no "no routes yet" or in-flight indication.
11. **Dead redirect** — `register.html` still redirects to `/login?success=1`, but login now always redirects to `/admin`, making that success banner unreachable.

### Web ↔ Desktop inconsistency
12. **Path format differs by surface** — the web expects a leading slash (`/ai`); the desktop expects a bare segment (`ai`) and adds the slash itself.
13. **Web cannot set tunnel type** — the web form never sends `type`, so routes created there silently default to `api`, while the desktop offers an explicit APP/API choice. The same action yields different results depending on where it is performed.
14. **Divergent visual identity** — the web uses flat Segoe UI styling; the desktop uses an Outfit/glassmorphism theme. Different palettes, spacing, components, and terminology ("Routes" vs "Tunnels").
15. **Inconsistent error presentation** — the desktop uses `alert()` for disconnect failures but inline banners elsewhere; the web surfaces nothing at all.

### Missing capabilities (deferred to a later phase)
16. `SERVER_URL` is hardcoded in `client-app/main.js` with no Settings field to change it.
17. Login is required on every app restart (session is memory-only); no "remember me".
18. No registration flow in the desktop app — users must find the website first.
19. No password reset and no email verification (any string is accepted as an email).
20. No `/health` endpoint for uptime monitoring or container healthchecks.
21. The `Log` model exists in `schema.prisma` but nothing ever writes to it.
22. No port validation on tunnel creation (accepts `0`, `99999`, etc.).

### Resolution (items 1–15; 16–22 remain deferred)
- **Tunnel lifecycle rebuilt around three explicit states** — `running` / `reconnecting` / `stopped` — replacing the old "only tracks live connections" model that caused item 2. On app restart every saved tunnel now honestly starts as `stopped` instead of falsely appearing active.
- **Auto-reconnect (item 5)**: a dropped SSH connection retries every 5s reusing the already-authorized private key (the server-side route/key are untouched by an unexpected drop, so no new HTTP round-trip is needed) — surfaced to the UI as the `reconnecting` status, pushed via a new `tunnels-changed` IPC event so the renderer reflects state changes that happen with no direct user action.
- **Stop vs Delete (item 8)**: desktop tunnels split into reversible **Stop** (tears down the SSH connection + server-side route/key via the existing `DELETE /admin/api/routes`, but keeps the tunnel's settings saved for one-click **Start**) and permanent **Delete** (Stop + forget locally, confirmation required). The web dashboard keeps a single confirmed **Delete** — its routes are static server-side config, not a desktop-managed live process, so "Stop" has no meaning there; this is a deliberate asymmetry, not a missed unification.
- **Public URL + copy (item 6)**: desktop now shows `${serverUrl}${remotePath}` per tunnel with a Copy button (`navigator.clipboard.writeText`).
- **Tray icon (item 3)**: fallback-to-empty-image logic kept for robustness, but a real icon is now in place.
- **Web dashboard (items 1, 4, 7, 9, 10, 12, 13, 14)**: fully rebuilt (`dashboard.html`, `login.html`, `register.html`) to match the desktop's dark/glassmorphism system — fixes the malformed-HTML bug outright, adds inline success/error banners (checks `res.ok`, previously didn't), a logout link, empty/loading states, a bare-path-segment input matching the desktop's convention, a Type (APP/API) dropdown, and only ever creates the "Registered Users" section in the DOM when `/admin/api/users` actually returns 200.
- **Dead redirect (item 11)**: `register.html` now redirects straight to `/admin` (the `/api/register` response already sets the session cookie, so bouncing through `/login?success=1` was pointless); the now-fully-dead success banner was removed from `login.html`.
- **Error presentation (item 15)**: desktop's Start/Stop/Delete failures use the same inline banner pattern as Connect, replacing the old `alert()` popup.
- **Two additional bugs caught during implementation** (not just assumed away): re-submitting an already-running tunnel path would have leaked the old SSH connection (fixed by tearing it down first); the shared error banner was originally nested inside the Bind Tunnel panel's markup, so an error triggered from the Tunnels panel would have been invisible (moved to a page-level element outside any single panel).
- **No server-side (`src/routes`, `src/middleware`, `src/lib`) changes were needed** — Stop/Start/Delete all reuse existing endpoints and existing ownership/CSRF/revocation logic.

## 💡 Implementation Status
- **Phases 1–6 (core functionality)**: implemented and verified working.
- **Security Hardening (Commercialization Phase 1)**: complete — all 11 items above implemented and verified end-to-end against a live server.
- **Desktop Client Redesign**: complete.
- **UI/UX Audit (Phase 2)**: complete — items 1–15 implemented; items 16–22 explicitly deferred. See `progress.md` for the working checklist.
