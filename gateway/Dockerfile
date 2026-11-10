# 1.27.3+ is needed for "server … resolve" in upstream blocks
FROM nginx:1.27-alpine
RUN apk add --no-cache curl openssl
COPY nginx.conf /etc/nginx/nginx.conf
# Creates a self-signed certificate when none is mounted (images pulled from Docker Hub)
COPY --chmod=755 docker-entrypoint.d/40-tenantwarden-certs.sh /docker-entrypoint.d/
RUN mkdir -p /etc/nginx/certs /usr/share/nginx/agent-dist
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
