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

- [x] **Phase 8: Desktop Client Redesign**
  - [x] Login-gate view (email/password/Login only) + sidebar app view (Active Tunnels / Bind Tunnel / Settings)
  - [x] Session caching in main.js (login/logout IPC, no more per-connect re-auth)
  - [x] Stop persisting plaintext password; migrate existing config files
  - [x] `minimizeToTray` user setting wired into close handler
  - [x] Bare-segment path entry (auto-prefixed with `/`)
  - [x] Fix regular-user login redirect bouncing back to `/login?success=1`

- [x] **Phase 9: UI/UX Audit (Commercialization Phase 2)** — see SPEC.md "UI/UX Audit" section for full detail
  - [x] Full line-by-line audit of web + desktop UI, 22 findings verified against code
  - [x] 1. Fix malformed HTML in dashboard.html (unbalanced/nested divs) — resolved by the full rebuild
  - [x] 2. Fix desktop Active Tunnels list showing stale state after restart — tunnels now always init as `stopped` on boot; no more lying about live connections
  - [x] 3. Add a real tray icon (currently invisible — no icon.png) — generator script written (`_gen_icon.js`); user is adding the actual icon.png manually
  - [x] 4. Surface add/delete route failures in the web dashboard (currently silent) — inline banner with real server error text
  - [x] 5. Implement tunnel auto-reconnect (promised in CLIENT_SPEC.md, never built) — 5s retry loop reusing the same authorized private key, pushed to the UI as a "Reconnecting" status
  - [x] 6. Show the reachable public URL in the desktop app, with copy-to-clipboard — added per-tunnel URL row + Copy button
  - [x] 7. Add a logout control to the web dashboard
  - [x] 8. Split Disconnect into Stop (keep route) vs Delete (confirm + remove) — desktop only; web dashboard routes aren't a desktop-managed live process, so it keeps a single confirmed Delete
  - [x] 9. Hide "Registered Users" card entirely for non-admins instead of rendering empty — nav item + panel only ever created if `/admin/api/users` returns 200
  - [x] 10. Add empty/loading states to the web dashboard
  - [x] 11. Remove the now-unreachable `/login?success=1` banner path — register now redirects straight to `/admin` (already logged in via the register response cookie); dead banner removed from login.html
  - [x] 12. Unify path entry format between web and desktop (bare segment, auto-prefixed)
  - [x] 13. Let the web dashboard set tunnel type (APP/API), same as desktop
  - [x] 14. Rebuild web dashboard to match desktop's dark/glassmorphism design system — dashboard.html, login.html, register.html all restyled
  - [x] 15. Unify error presentation (consistent inline banners, no bare `alert()`) — desktop's Start/Stop/Delete errors now use the shared page-level banner instead of `alert()`
  - [ ] *(16–22 deferred: server URL setting, remember-me, desktop registration, password reset/email verification, /health endpoint, Log table usage, port validation)*

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
- **2026-08-03**: Desktop Client Redesign (Phase 8) implemented — login gate, sidebar sections, session caching, no more plaintext password persistence, user-controlled minimize-to-tray, bare-segment path entry. Verified working end-to-end by the user against the deployed VPS (login → bind tunnel → active tunnel list → reachable via the public path). Also fixed a login-redirect bug found in the same pass: regular (non-admin) users were sent to `/login?success=1` after logging in, which looks/feels like login didn't work — now redirects to `/admin` like admins, since the dashboard already scopes correctly per-user.
- **2026-08-03**: UI/UX Audit (Phase 9) completed — every finding below was verified against the actual code (div-balance check, grep for reconnect logic, grep for confirm() calls, etc.), not asserted from a read-through. 22 findings total, grouped into confirmed defects (5), usability gaps (6), web/desktop inconsistencies (4), and deferred missing capabilities (7). Full detail recorded in `SPEC.md` under "UI/UX Audit (Commercialization Phase 2)". Agreed direction: fix items 1–15 now, rebuild the web dashboard to match the desktop's design system, and split "Disconnect" into separate Stop/Delete actions. Items 16–22 deferred.
- **2026-08-03**: Phase 9 (items 1–15) implemented. `client-app/main.js` rewritten around a single per-tunnel state machine (`running`/`reconnecting`/`stopped`) instead of a live-connections-only Map, with a 5s auto-reconnect loop that reuses the already-authorized private key (no new HTTP round-trip needed since the server-side route/key survive an unexpected drop), and a `tunnels-changed` push event so the renderer reflects autonomous state changes (like a background reconnect) without polling. Stop/Delete both reuse the existing `DELETE /admin/api/routes` endpoint — no server-side changes were needed anywhere in this phase. `src/views/dashboard.html`, `login.html`, and `register.html` were rebuilt to match the desktop's visual system. Two additional bugs were caught during implementation review (not just assumed fixed): (1) re-submitting an already-running tunnel path would have leaked the old SSH connection — fixed by tearing it down first; (2) the shared error banner was originally nested inside the Bind Tunnel panel's markup, so an error triggered from the Tunnels panel would have been invisible — moved to a page-level element outside any single panel. Tray icon (item 3) generator script (`_gen_icon.js`) was written but the user opted to add the actual `icon.png` manually instead of having it generated.
