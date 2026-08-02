# SPEC.MD: Authenticated Reverse Proxy Middleware & Admin Dashboard

## ✅ Confirmed Requirements & Scope
- **Core Functionality**: A middleware proxy server that authenticates an Admin (via hardcoded ENV variables) and End-Users (via PostgreSQL Database). Authorized traffic is routed to specific local ports based on dynamic URL paths.
- **Admin Dashboard**: A secure, server-rendered HTML/JS UI where the admin can view, add, edit, and delete proxy routes.
- **Desktop Client Integration**: A local Electron app establishes an SSH reverse tunnel to the VPS, mapping local apps to the proxy.
- **Hot-Reloading**: Changes to proxy routes made in the dashboard take effect instantly without restarting the server.
- **Storage**: Proxy routes are stored persistently in a lightweight `routes.json` file. User data is stored in PostgreSQL.
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
├── .env                  # Admin Credentials & Database URL
├── routes.json           # Persistent storage for dynamic proxy routes
├── prisma/
│   └── schema.prisma     # PostgreSQL User schema
├── docker-compose.yml    # Orchestrates Auth Proxy & PostgreSQL
├── Dockerfile            # Container definition for the proxy
├── client-app/           # Desktop Client Application
│   ├── main.js           # SSH Tunneling logic
│   └── src/renderer.js   # Client UI
└── src/
    ├── index.ts          # Server entry point & global middlewares
    ├── config.ts         # Environment validation
    ├── db.ts             # Prisma Client singleton
    ├── lib/
    │   └── routeManager.ts # Helper to read/write routes.json instantly
    ├── middleware/
    │   ├── auth.ts       # JWT verification & login redirect logic
    │   └── dynamicProxy.ts # Singleton proxy intercepting HTTP/WS traffic
    ├── routes/
    │   ├── admin.ts      # API endpoints for the dashboard
    │   └── api.ts        # End-user authentication and SSH key registration
    └── views/
        ├── login.html    # Minimalist login UI
        ├── register.html # End-user registration UI
        └── dashboard.html # Beautiful UI to manage ports
```

## 🔌 Configuration Schemas

**`.env` File**
```env
PORT=4000
JWT_SECRET=super_secret_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=securepassword
DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/auth_proxy"
VPS_IP=203.57.85.144
```

## ⚠️ Critical Architecture Decisions & Edge Cases Resolved
1. **Dynamic Proxy Target Missing**: Handled by falling back to a dummy target (`http://127.0.0.1:65535`) and explicitly catching `ECONNREFUSED` on that port to return a clean 404 response.
2. **WebSocket Support (`upgrade` events)**: `http-proxy-middleware` cannot intercept WebSockets dynamically inside an Express route. The proxy is implemented as a Singleton and explicitly bound to `server.on('upgrade')`.
3. **Node.js Idle Timeouts**: Node.js defaults to a 5-second `keepAliveTimeout`. For long-running proxy requests (e.g., TTS Audio Generation), this caused random connection drops. Fixed by increasing server timeouts to 5 minutes (`300000ms`).
4. **URL Collision with Express Body Parser**: Mounting `express.json()` globally on `/api` caused it to consume the JSON bodies of proxied POST requests. Fixed by passing `express.json()` *only* to specific internal endpoints.
5. **TCP Half-Open Streams**: Node's TCP socket destroys itself upon receiving an EOF from the client HTTP request, cutting off the backend response. Fixed by enabling `allowHalfOpen: true` on the Desktop client's local socket proxy.
6. **Prisma v7 Deprecations**: The `--skip-generate` flag is removed in Prisma v7. Startup commands were updated to standard `prisma db push`.

## 💡 Implementation Complete
The project has successfully progressed through all design, planning, implementation, and verification phases. The system is actively deployed and fully functional.
