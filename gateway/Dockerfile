# 1.27.3+ is needed for "server … resolve" in upstream blocks
FROM nginx:1.27-alpine
RUN apk add --no-cache curl
COPY nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /etc/nginx/certs
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
