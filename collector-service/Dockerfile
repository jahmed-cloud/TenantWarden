FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS builder
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S tenantwarden && adduser -S -G tenantwarden tenantwarden
COPY --chown=tenantwarden:tenantwarden --from=deps /app/node_modules ./node_modules
COPY --chown=tenantwarden:tenantwarden --from=builder /app/dist ./dist
COPY --chown=tenantwarden:tenantwarden package.json ./
USER tenantwarden
EXPOSE 3001
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1))"
CMD ["node", "dist/index.js"]
