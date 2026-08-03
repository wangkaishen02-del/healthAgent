#!/bin/sh
set -eu

until /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://keycloak:8080 \
  --realm master \
  --user "$KEYCLOAK_ADMIN_USERNAME" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

client_id=$(/opt/keycloak/bin/kcadm.sh get clients -r healthagent -q clientId=healthagent-web --fields id --format csv --noquotes | tail -n 1)
if [ -z "$client_id" ]; then
  echo "healthagent-web client not found" >&2
  exit 1
fi

/opt/keycloak/bin/kcadm.sh update realms/healthagent \
  -s 'loginTheme=healthagent' \
  -s 'internationalizationEnabled=true' \
  -s 'defaultLocale=zh-CN' \
  -s 'supportedLocales=["zh-CN","en"]'

/opt/keycloak/bin/kcadm.sh update "clients/$client_id" -r healthagent \
  -s "rootUrl=$PUBLIC_BASE_URL" \
  -s "baseUrl=$PUBLIC_BASE_URL" \
  -s "redirectUris=[\"$PUBLIC_BASE_URL/*\"]" \
  -s "webOrigins=[\"$PUBLIC_BASE_URL\"]"
