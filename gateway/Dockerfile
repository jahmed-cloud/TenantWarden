FROM nginx:1.25-alpine
RUN apk add --no-cache curl
COPY nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /etc/nginx/certs
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
