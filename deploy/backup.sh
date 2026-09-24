#!/usr/bin/env bash
# Nightly encrypted Postgres backup with 14-day retention.
#   BACKUP_PASSPHRASE=... ./deploy/backup.sh            (cron: 30 2 * * *)
# Restore: gpg -d FILE.sql.gz.gpg | gunzip | docker compose exec -T postgres psql -U shahbal shahbal
# The dump contains personal data (IDs are already field-encrypted, but names and
# phones are not), so it is encrypted before it touches disk. Store the
# passphrase in a password manager, not on this server, and copy backups off-site.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
DEST="${BACKUP_DIR:-/var/backups/campaign-hq}"
mkdir -p "$DEST" && chmod 700 "$DEST"
FILE="$DEST/shahbal-$(date +%Y%m%d-%H%M%S).sql.gz.gpg"
docker compose exec -T postgres pg_dump -U shahbal --no-owner shahbal \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$FILE" 3<<<"$BACKUP_PASSPHRASE"
chmod 600 "$FILE"
find "$DEST" -name 'shahbal-*.sql.gz.gpg' -mtime +14 -delete
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"
