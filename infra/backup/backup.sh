#!/bin/sh
set -eu

backup_once() {
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  app_file="/backups/healthagent_${timestamp}.dump"
  keycloak_file="/backups/keycloak_${timestamp}.dump"

  PGPASSWORD="$APP_DB_PASSWORD" pg_dump \
    --host=postgres --username="$APP_DB_USER" --dbname="$APP_DB_NAME" \
    --format=custom --compress=9 --file="$app_file"
  pg_restore --list "$app_file" >/dev/null

  PGPASSWORD="$KEYCLOAK_DB_PASSWORD" pg_dump \
    --host=keycloak-postgres --username="$KEYCLOAK_DB_USER" --dbname="$KEYCLOAK_DB_NAME" \
    --format=custom --compress=9 --file="$keycloak_file"
  pg_restore --list "$keycloak_file" >/dev/null

  sha256sum "$app_file" "$keycloak_file" > "/backups/checksums_${timestamp}.sha256"
  find /backups -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
  echo "backup completed: $timestamp"
}

mkdir -p /backups
if [ "${BACKUP_ONCE:-false}" = "true" ]; then
  backup_once
  exit 0
fi

if [ "${BACKUP_ON_START:-true}" = "true" ]; then
  backup_once
fi

while true; do
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
  backup_once
done
