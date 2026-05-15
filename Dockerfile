FROM node:22 AS base

# dependencies stage
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install build dependencies for better-sqlite3 native addon
RUN apt-get update && apt-get install -y python3 make g++ && npm ci

# build stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# runner stage
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm", "start"]
