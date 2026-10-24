# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

# ── Stage 2: development ──────────────────────────────────────────────────────
FROM deps AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npm run build

# ── Stage 4: production (nginx) ───────────────────────────────────────────────
FROM nginx:1.25-alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Run as non-root: nginx needs writable temp/pid paths
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx \
 && sed -i 's,/var/run/nginx.pid,/tmp/nginx.pid,' /etc/nginx/nginx.conf \
 && sed -i '/user  nginx;/d' /etc/nginx/nginx.conf
USER nginx
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
