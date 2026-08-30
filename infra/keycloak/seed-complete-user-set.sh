#!/bin/sh
set -eu

KEYCLOAK_URL=${KEYCLOAK_URL:-http://127.0.0.1:8080}
BUSINESS_REALM=${BUSINESS_REALM:-healthagent}
BUSINESS_INITIAL_PASSWORD=${BUSINESS_INITIAL_PASSWORD:-HealthAgent@2026!}
PLATFORM_ADMIN_USERNAME=${PLATFORM_ADMIN_USERNAME:-platform-admin}
PLATFORM_ADMIN_INITIAL_PASSWORD=${PLATFORM_ADMIN_INITIAL_PASSWORD:-KeycloakAdmin@2026!}
CREATE_PLATFORM_ADMIN=${CREATE_PLATFORM_ADMIN:-false}
KEYCLOAK_ADMIN_USERNAME=${KEYCLOAK_ADMIN_USERNAME:-${KC_BOOTSTRAP_ADMIN_USERNAME:-}}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:-${KC_BOOTSTRAP_ADMIN_PASSWORD:-}}

: "${KEYCLOAK_ADMIN_USERNAME:?KEYCLOAK_ADMIN_USERNAME is required}"
: "${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD is required}"

KCADM=/opt/keycloak/bin/kcadm.sh

"$KCADM" config credentials \
  --server "$KEYCLOAK_URL" \
  --realm master \
  --user "$KEYCLOAK_ADMIN_USERNAME" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

user_id() {
  realm=$1
  username=$2
  "$KCADM" get users -r "$realm" -q "username=$username" -q exact=true \
    --fields id --format csv --noquotes | tail -n 1
}

ensure_user() {
  realm=$1
  username=$2
  first_name=$3
  last_name=$4
  email=$5
  initial_password=$6

  id=$(user_id "$realm" "$username")
  if [ -z "$id" ]; then
    "$KCADM" create users -r "$realm" \
      -s "username=$username" \
      -s enabled=true \
      -s emailVerified=true \
      -s "email=$email" \
      -s "firstName=$first_name" \
      -s "lastName=$last_name" >/dev/null
    "$KCADM" set-password -r "$realm" \
      --username "$username" \
      --new-password "$initial_password" \
      --temporary >/dev/null
    echo "created:$realm:$username"
  else
    "$KCADM" update "users/$id" -r "$realm" \
      -s enabled=true \
      -s emailVerified=true \
      -s "email=$email" \
      -s "firstName=$first_name" \
      -s "lastName=$last_name" >/dev/null
    echo "kept-existing-password:$realm:$username"
  fi
}

assign_realm_roles() {
  realm=$1
  username=$2
  shift 2
  for role in "$@"; do
    "$KCADM" add-roles -r "$realm" --uusername "$username" --rolename "$role" >/dev/null
  done
}

ensure_user "$BUSINESS_REALM" query-user 查询 专员 query-user@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" query-user claim_viewer

ensure_user "$BUSINESS_REALM" acceptance-user 受理 专员 acceptance-user@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" acceptance-user claim_acceptor

ensure_user "$BUSINESS_REALM" calculation-user 理算 专员 calculation-user@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" calculation-user claim_calculator

ensure_user "$BUSINESS_REALM" review-user 审核 专员 review-user@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" review-user claim_reviewer

ensure_user "$BUSINESS_REALM" business-admin 业务 管理员 business-admin@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" business-admin claim_admin

ensure_user "$BUSINESS_REALM" full-process-user 全流程 专员 full-process-user@healthagent.local "$BUSINESS_INITIAL_PASSWORD"
assign_realm_roles "$BUSINESS_REALM" full-process-user claim_viewer claim_acceptor claim_calculator claim_reviewer

if [ "$CREATE_PLATFORM_ADMIN" = "true" ]; then
  ensure_user master "$PLATFORM_ADMIN_USERNAME" 平台 管理员 platform-admin@healthagent.local "$PLATFORM_ADMIN_INITIAL_PASSWORD"
  "$KCADM" add-roles -r master \
    --uusername "$PLATFORM_ADMIN_USERNAME" \
    --cclientid realm-management \
    --rolename realm-admin >/dev/null
  echo "platform-admin-ready:$PLATFORM_ADMIN_USERNAME"
else
  echo "platform-admin-skipped"
fi

echo "complete-user-set-ready"
