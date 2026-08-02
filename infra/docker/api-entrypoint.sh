#!/bin/sh
set -eu

database_state=$(node /app/infra/docker/database-state.mjs)

if [ "$database_state" = "empty" ]; then
  echo "Initializing an empty healthAgent database from the current Prisma schema"
  ./node_modules/.bin/prisma db push --skip-generate
  for migration_dir in /app/prisma/migrations/*; do
    migration_name=${migration_dir##*/}
    ./node_modules/.bin/prisma migrate resolve --applied "$migration_name"
  done
elif [ "$database_state" = "unbaselined" ]; then
  echo "Database contains tables but has no migration history; refusing automatic baseline" >&2
  echo "Follow docs/production-deployment.md to verify and baseline it explicitly" >&2
  exit 1
else
  ./node_modules/.bin/prisma migrate deploy
fi

exec node dist/nest/apps/api/src/main.js
