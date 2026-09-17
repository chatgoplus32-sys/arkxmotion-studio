#!/bin/bash
# ============================================================
# Gerbang 3 — boot produksi harus meninggalkan snapshot backup.
#
# Kenapa ada: "backup saat start" bisa tidak terjadi tanpa ada yang tahu.
# Terukur pada deploy 17 Sep 2026: gerbang 2 (smoke test) menulis snapshot
# pukul 11:42:10, pm2 restart pukul 11:42:19, dan proses produksi TIDAK pernah
# menulis snapshot sendiri — 31 menit setelah boot, local.latest masih berkas
# milik smoke test itu. Tidak ada error yang terlihat dari luar, dan deploy
# dilaporkan sukses.
#
# Gerbang ini mengukurnya dari dalam VPS, tempat semuanya bisa dibuktikan:
#   1. tunggu sampai /api/health menjawab (proses hidup)
#   2. pastikan proses MEMANG baru start, bukan restart yang tidak berefek
#   3. tunggu sampai ada snapshot yang lebih baru dari start proses itu
# Kalau tidak ada, deploy ditandai gagal — dan penyebabnya ikut dicetak.
#
# Pemakaian (dari root project):
#   bash scripts/check-boot-backup.sh [epoch_perintah_restart]
#
# Override (dipakai tes): BASE_URL, BACKUP_DIR, WAIT_SECONDS, GRACE_SECONDS,
#                         POLL_SECONDS, PM2_NAME, LOG_DIR
#
# Exit 0 = boot meninggalkan snapshot. Exit 1 = tidak, beserta diagnosisnya.
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESTART_MARKER="${1:-0}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-6000}}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/data/backups}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
POLL_SECONDS="${POLL_SECONDS:-3}"
PM2_NAME="${PM2_NAME:-arkxmotion}"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
# Toleransi pembulatan saja — HARUS kecil. Snapshot gerbang 2 (smoke test) duduk
# beberapa detik SEBELUM restart, dan kalau toleransinya longgar, snapshot itu
# akan lolos sebagai "bukti boot" padahal bukan.
GRACE_SECONDS="${GRACE_SECONDS:-3}"

waktu() { date -d "@$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "@$1"; }

newest_snapshot() {
  local f t best_t=0 best=""
  for f in "$BACKUP_DIR"/arkxmotion-*.db; do
    [ -e "$f" ] || continue
    t=$(stat -c %Y "$f" 2>/dev/null) || continue
    if [ "$t" -gt "$best_t" ]; then best_t="$t"; best="$f"; fi
  done
  [ -n "$best" ] && printf '%s %s\n' "$best_t" "$best"
}

sebab_backup() {
  echo ""
  echo "--- status backup saat ini ---"
  curl -s --max-time 10 "$BASE_URL/api/backup/status" 2>/dev/null || echo "(tidak bisa menghubungi $BASE_URL/api/backup/status)"
  echo ""
  echo "--- 5 berkas terbaru di $BACKUP_DIR ---"
  local f
  for f in $(ls -1t "$BACKUP_DIR"/arkxmotion-*.db 2>/dev/null | head -5); do
    echo "   $(waktu "$(stat -c %Y "$f" 2>/dev/null || echo 0)")  $(basename "$f")"
  done
  echo ""
  echo "--- baris log yang menyebut backup ---"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs "$PM2_NAME" --lines 150 --nostream 2>/dev/null | grep -i 'backup' | tail -20
  fi
  if [ -f "$LOG_DIR/out.log" ]; then
    echo "   (dari $LOG_DIR/out.log)"
    grep -i 'backup' "$LOG_DIR/out.log" 2>/dev/null | tail -20
  fi
  if [ -f "$LOG_DIR/error.log" ]; then
    echo "   (dari $LOG_DIR/error.log)"
    grep -i 'backup' "$LOG_DIR/error.log" 2>/dev/null | tail -20
  fi
  echo ""
  echo "Sudah menyala? Setelah penyebabnya dibereskan, boot berikutnya harus"
  echo "meninggalkan snapshot. Untuk memeriksa manual tanpa deploy:"
  echo "   bash scripts/check-boot-backup.sh"
}

fail() {
  echo ""
  echo "❌ GERBANG 3 GAGAL: $1"
  sebab_backup
  exit 1
}

echo "🧪 Gerbang 3 — boot harus meninggalkan snapshot backup"
echo "   URL     : $BASE_URL"
echo "   Backup  : $BACKUP_DIR"
[ "$RESTART_MARKER" -gt 0 ] && echo "   Restart : $(waktu "$RESTART_MARKER")"

mulai=$(date +%s)
batas=$((mulai + WAIT_SECONDS))

# ── 1. Tunggu proses melayani ────────────────────────────────────────────────
health=""
while [ "$(date +%s)" -lt "$batas" ]; do
  health=$(curl -sf --max-time 5 "$BASE_URL/api/health" 2>/dev/null || true)
  [ -n "$health" ] && break
  sleep 1
done
[ -n "$health" ] || fail "server tidak merespons $BASE_URL/api/health dalam ${WAIT_SECONDS}s"

uptime_raw=$(printf '%s' "$health" | grep -o '"uptime":[0-9.]*' | head -1 | cut -d: -f2)
[ -n "$uptime_raw" ] || fail "respons /api/health tidak memuat uptime, jadi kapan proses start tidak bisa ditentukan"
uptime_int="${uptime_raw%%.*}"
proc_start=$(($(date +%s) - uptime_int))
echo "   Proses hidup ${uptime_int}s → start $(waktu "$proc_start")"

# ── 2. Restart harus benar-benar terjadi ────────────────────────────────────
if [ "$RESTART_MARKER" -gt 0 ] && [ "$proc_start" -lt $((RESTART_MARKER - 15)) ]; then
  fail "proses yang melayani TIDAK baru start: start $(waktu "$proc_start") lebih tua dari perintah restart $(waktu "$RESTART_MARKER"). Periksa apakah 'pm2 restart' benar-benar mengganti prosesnya."
fi

# ── 3. Tunggu snapshot yang lebih baru dari start proses ────────────────────
ambang=$((proc_start - GRACE_SECONDS))
echo "   Menunggu snapshot lebih baru dari $(waktu "$ambang") (maks ${WAIT_SECONDS}s)…"

while [ "$(date +%s)" -lt "$batas" ]; do
  newest=$(newest_snapshot)
  if [ -n "$newest" ]; then
    t="${newest%% *}"
    f="${newest#* }"
    if [ "$t" -ge "$ambang" ]; then
      echo "   ✓ $(basename "$f") — $(waktu "$t")"
      echo ""
      echo "✅ GERBANG 3 LOLOS — boot meninggalkan snapshot backup"
      exit 0
    fi
  fi
  sleep "$POLL_SECONDS"
done

if [ -n "$(newest_snapshot)" ]; then
  newest="$(newest_snapshot)"
  fail "tidak ada snapshot yang lebih baru dari start proses $(waktu "$proc_start"). Snapshot terbaru: $(basename "${newest#* }") dari $(waktu "${newest%% *}") — lebih tua, jadi bukan bukti boot ini. Artinya backup saat start TIDAK berjalan."
fi
fail "tidak ada snapshot sama sekali di $BACKUP_DIR. Backup saat start TIDAK berjalan."
