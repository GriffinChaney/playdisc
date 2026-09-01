#!/usr/bin/env bash
# Snapshot the repo (tracked files at HEAD) into a timestamped zip and keep
# only the newest few. Run from anywhere inside the repo:  npm run backup
#
# Backups land in ~/Developer/sona-backups by default; override with
#   PLAYDISC_BACKUP_DIR=/some/other/dir npm run backup
set -euo pipefail

DEST="${PLAYDISC_BACKUP_DIR:-$HOME/Developer/sona-backups}"
KEEP="${PLAYDISC_BACKUP_KEEP:-15}"

mkdir -p "$DEST"
cd "$(git rev-parse --show-toplevel)"

stamp=$(date +%Y%m%d-%H%M)
tag=$(git describe --tags --always --dirty 2>/dev/null || echo nogit)
out="$DEST/playdisc-${stamp}-${tag}.zip"

git archive --format=zip -o "$out" HEAD

# prune: keep only the newest $KEEP (matches both the old sona-*.zip backups
# and the new playdisc-*.zip ones, so rotation carries across the rename)
ls -1t "$DEST"/*.zip 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
done

echo "backup  -> $out ($(du -h "$out" | cut -f1))"
echo "kept    -> $(ls -1 "$DEST"/*.zip 2>/dev/null | wc -l | tr -d ' ') in $DEST"
