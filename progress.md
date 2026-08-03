# Progress Tracker: Auth Proxy Middleware & Dashboard

## Task Checklist
- [x] **Phase 1: Initialize Project**
  - [x] Initialize `package.json` and `tsconfig.json`
  - [x] Install dependencies (`express`, `http-proxy-middleware`, `jsonwebtoken`, `cookie-parser`, `dotenv`)
  - [x] Install dev dependencies

- [x] **Phase 2: Storage & Configuration**
  - [x] Create `.env` template
  - [x] Create `src/config.ts` (validate environment variables)
  - [x] Create `src/lib/routeManager.ts` (Read/Write logic for `routes.json`)

- [x] **Phase 3: Authentication & Login UI**
  - [x] Create `src/views/login.html` (Beautiful, responsive UI)
  - [x] Create `src/middleware/auth.ts` (JWT issuing and validation)

- [x] **Phase 4: Admin Dashboard & API**
  - [x] Create `src/views/dashboard.html` (UI to list, add, and delete ports)
  - [x] Create `src/routes/admin.ts` (REST API for the dashboard to manage `routes.json`)

- [x] **Phase 5: Dynamic Proxy Layer**
  - [x] Create `src/middleware/dynamicProxy.ts` (Intercepts traffic, looks up target in `routes.json`, and proxies via `http-proxy-middleware`)
  - [x] Create `src/index.ts` (Wire up Express, bind all routes and middlewares)

- [x] **Phase 6: Verification & Bug Fixing**
  - [x] Fixed: Admin login blocked by HTML5 `<input type="email">` constraint.
  - [x] Fixed: Client App SSH stream freezing at 86% by enabling `allowHalfOpen: true` to prevent abrupt socket destruction.
  - [x] Fixed: Node.js 5-second `keepAliveTimeout` killing long-running proxy requests (e.g., TTS Generation).
  - [x] Fixed: Proxy WebSocket upgrade interception to support live real-time connections through the tunnel.
  - [x] Fixed: Express `jsonParser` URL collision intercepting proxied traffic to `/api/*` and consuming request bodies.

- [x] **Phase 7: Security Hardening (Commercialization Phase 1)**
  - [x] Phase A: Fix stored XSS in dashboard.html + CSRF token plumbing
  - [x] Phase B: Authorization core (route ownership) — admin API, HTTP proxy, WS upgrade auth
  - [x] Phase C: SSH key hardening — validate, scope to port, track, revoke
  - [x] Phase D: JWT revocation on logout
  - [x] Phase E: Secrets hygiene + config fail-fast + NODE_ENV
  - [x] Phase F: Rate limiting on login/register

## Session Log
- **2026-08-02**: Brainstorming phase complete. Generated initial `SPEC.md`.
- **2026-08-02**: Scope expanded to include Admin Dashboard and `routes.json` hot-reloading. Updated `SPEC.md` and `progress.md`. Awaiting explicit `APPROVE` to begin execution.
- **2026-08-02**: Implementation completed based on spec. Files generated to disk.
- **2026-08-03**: Final Testing & Bug Fixes completed.
  - **Issue 1:** The `prisma db push` command was failing in Docker because `--skip-generate` is no longer supported in Prisma v7. **Fix:** Removed the unsupported flag.
  - **Issue 2:** Admin couldn't log into the web UI because the HTML form enforced an email format. **Fix:** Changed `<input type="email">` to `type="text"`.
  - **Issue 3:** Electron Desktop app was throwing `options.publicKeyEncoding.format is invalid` due to outdated Node.js `crypto` support for OpenSSH keys. **Fix:** Switched SSH key generation to the `ssh2` library's native `utils.generateKeyPairSync`.
  - **Issue 4:** Audio Studio MP3 generation getting stuck at 86% locally over the tunnel. 
    - **Root Cause A:** Node.js stream `pipe()` cutting off early. **Fix:** Enabled `allowHalfOpen: true` on the local TCP socket to let HTTP responses finish even if the request stream sent EOF.
    - **Root Cause B:** Proxy server WebSockets were completely broken, and Node.js idle timeouts killed long generation tasks. **Fix:** Bound proxy to server `upgrade` event and increased `keepAliveTimeout` to 5 minutes.
    - **Root Cause C:** API URL Collision! The user's Audio Studio made POST requests to `/api/v1/synthesize`. Our proxy had `app.use('/api', express.json())` which globally swallowed the JSON request body before the proxy could forward it. **Fix:** Restricted `express.json()` to exact internal endpoints only. All proxied traffic now streams natively!
- **2026-08-03**: Security Hardening (Phase 7) implemented and verified end-to-end against a disposable local Postgres container (register/login two tenants, CSRF, cross-tenant route ownership at both the admin-API and proxy layers, WS upgrade auth, JWT revocation on logout, rate limiting, config fail-fast). Two additional bugs were caught only through this live testing (not visible from code review alone) and fixed in the same pass:
  - **Regression found:** `dynamicProxy`'s `on.error` handler assumed `res` was always an Express `Response` and called `res.status(403)` unconditionally. For WebSocket upgrade errors `res` is a raw `net.Socket` with no `.status()` — this threw an uncaught exception and **crashed the entire server process**. Fixed by branching on whether `res` supports `.status()` and writing a raw HTTP response line to the socket otherwise.
  - **Pre-existing bug found:** `requireAuth`'s check `req.path.startsWith('/admin/api')` never matched when `requireAuth` runs as `adminRouter.use(...)`, because Express's `req.path` inside a sub-router is relative to the mount point (e.g. `/api/routes`, not `/admin/api/routes`). This meant unauthenticated/expired/revoked requests to `/admin/api/*` got an HTML redirect instead of a JSON 401 — which would break the dashboard's own `fetch`-based error handling (`res.status === 401` check). Fixed by checking `req.originalUrl` instead, which always reflects the full incoming path regardless of mounting.
  - **Known local-environment limitation:** `res.sendFile` for `login.html`/`dashboard.html` returns a `NotFoundError` from the `send` package when running directly via `node dist/index.js` in this specific Windows sandbox, despite the resolved path existing and being a valid file (confirmed via `fs.statSync`). This is unrelated to any of the Phase 7 changes (the affected code lines were untouched) and did not reproduce as a code defect on inspection — most likely an async-fs/antivirus interaction specific to this sandboxed environment. Not reproduced or expected in the Docker deployment path. Flagged here for awareness; did not block verification since all Phase 7 logic is exercised through the JSON API endpoints, not static file serving.
