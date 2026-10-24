FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
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
EXPOSE 3002
CMD ["node", "dist/index.js"]
