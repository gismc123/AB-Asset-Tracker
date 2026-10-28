# Reverse proxy in front of stock Actual. Passes everything through and adds
# one <script> tag to Actual's HTML. Contains no Actual code.
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY nginx.conf.template /etc/asset-tracker/nginx.conf.template
COPY 40-asset-tracker-setup.sh /docker-entrypoint.d/40-asset-tracker-setup.sh
RUN chmod +x /docker-entrypoint.d/40-asset-tracker-setup.sh && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 8443
