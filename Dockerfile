# Stage 1: Build the TypeScript code
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files and install ALL dependencies (including devDependencies for TS compilation)
COPY package*.json ./
RUN npm install

# Copy source code and Prisma schema
COPY . .

# Generate Prisma Client (needed for TS compilation and runtime)
RUN npx prisma generate

# Build TypeScript code
RUN npm run build

# Stage 2: Production environment
FROM node:20-alpine

WORKDIR /usr/src/app

# NOTE: this makes cookies `secure`-only (see src/config.ts / issueSessionCookies).
# Do NOT deploy this image until a TLS-terminating reverse proxy (Nginx/Caddy/Traefik)
# sits in front of it — otherwise the browser will refuse to store the auth cookie
# and login will break for every user.
ENV NODE_ENV=production

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the compiled output from the builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Copy the static HTML views needed at runtime
# Since outDir is dist, we ensure views exist relative to the build
COPY --from=builder /usr/src/app/src/views ./src/views

# Copy the prisma client generated files and schema
COPY --from=builder /usr/src/app/prisma.config.ts ./prisma.config.ts
COPY prisma ./prisma

# Generate Prisma Client explicitly in production so the correct Query Engines are pulled
RUN npx prisma generate

# Expose the default port
EXPOSE 4000

# Start: auto-migrate DB schema then launch the server
CMD ["sh", "-c", "npx prisma db push --url \"$DATABASE_URL\" && npm start"]
