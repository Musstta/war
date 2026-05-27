#!/bin/sh
# Periodic pg_dump backup. Runs inside the backup container.
# Writes compressed SQL dumps to /backups (bind-mounted from the host).
# Prunes dumps older than KEEP_DAYS (default 7).
set -e

BACKUP_DIR=/backups
KEEP_DAYS="${KEEP_DAYS:-7}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-3600}"

echo "[backup] Starting. Interval: ${INTERVAL}s, retention: ${KEEP_DAYS} days."

while true; do
  sleep "$INTERVAL"
  FILENAME="${BACKUP_DIR}/war_$(date +%Y%m%d_%H%M%S).sql.gz"
  pg_dump -h postgres -U war war | gzip > "$FILENAME"
  echo "[backup] Written: $FILENAME"
  find "$BACKUP_DIR" -name '*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
done
