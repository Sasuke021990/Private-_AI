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
