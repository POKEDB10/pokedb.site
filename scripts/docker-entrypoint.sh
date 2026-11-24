#!/bin/sh
set -e

DB_FILE="${SQLITE_DB_PATH:-/app/data/pokedb.sqlite}"
CONFIG_FILE="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

# Map R2 credentials to Litestream AWS environment variables if provided
if [ -n "${R2_ACCESS_KEY_ID}" ] && [ -z "${LITESTREAM_ACCESS_KEY_ID}" ]; then
  export LITESTREAM_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
fi
if [ -n "${R2_SECRET_ACCESS_KEY}" ] && [ -z "${LITESTREAM_SECRET_ACCESS_KEY}" ]; then
  export LITESTREAM_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
fi

# Ensure data storage directory exists
mkdir -p "$(dirname "$DB_FILE")"

# Check if Litestream is configured and credentials are set
if [ -f "$CONFIG_FILE" ] && [ -n "${LITESTREAM_ACCESS_KEY_ID}" ] && [ -n "${LITESTREAM_SECRET_ACCESS_KEY}" ] && [ -n "${R2_ACCOUNT_ID}" ]; then
  echo "[entrypoint] Litestream credentials detected. Checking for replica restore..."
  if [ ! -f "$DB_FILE" ]; then
    echo "[entrypoint] Local database missing at $DB_FILE. Restoring from R2 replica if present..."
    litestream restore -if-replica-exists -config "$CONFIG_FILE" "$DB_FILE" || echo "[entrypoint] Restore skipped or no replica found."
  fi

  echo "[entrypoint] Starting Litestream continuous replication (sync-interval: 30s)..."
  exec litestream replicate -config "$CONFIG_FILE" -exec "$*"
fi

# Fail closed if REQUIRE_REPLICATION=1 is set and credentials or config are missing (Task R2.5f)
if [ "${REQUIRE_REPLICATION}" = "1" ]; then
  echo "[entrypoint] FATAL: REQUIRE_REPLICATION=1 is set, but required Litestream R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) or config file ($CONFIG_FILE) are missing. Failing closed." >&2
  exit 1
fi

echo "[entrypoint] Litestream unconfigured or absent. Booting application directly..."
exec "$@"
