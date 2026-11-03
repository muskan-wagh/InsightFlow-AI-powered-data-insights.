# ── Stage 1: dependencies ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci runs the postinstall hook, which copies the DuckDB-Wasm bundle
# from node_modules into public/duckdb-wasm
RUN npm ci --no-audit --no-fund

# ── Stage 2: production build ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# PUB_KEY (OPENROUTER_*) is NOT needed at build time — the LLM proxy reads it per request.
RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER app
EXPOSE 3000
CMD ["npm", "start"]
