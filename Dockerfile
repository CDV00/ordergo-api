# syntax=docker/dockerfile:1.7

# ─── Base ─────────────────────────────────────────────────
FROM node:20-alpine AS base
ENV TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata libc6-compat \
 && cp /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo $TZ > /etc/timezone
WORKDIR /opt

# ─── Install all deps ─────────────────────────────────────
FROM base AS deps
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile

# ─── Build ────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /opt/node_modules ./node_modules
COPY . .
RUN yarn build

# ─── Prod-only deps ───────────────────────────────────────
FROM base AS prod-deps
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --production && \
    yarn cache clean

# ─── Runtime ──────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
ENV TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata wget \
 && cp /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo $TZ > /etc/timezone

WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=prod-deps --chown=nestjs:nodejs /opt/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /opt/dist ./dist
COPY --from=build --chown=nestjs:nodejs /opt/package.json ./package.json

USER nestjs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/v1/health || exit 1

CMD ["node", "dist/main.js"]
