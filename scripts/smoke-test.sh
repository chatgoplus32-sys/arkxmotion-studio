#!/bin/bash
# ============================================================
# Smoke test — benar-benar menjalankan server lalu cek endpoint.
#
# Kenapa ada: `tsc -b` TIDAK memeriksa folder server/. Kesalahan seperti
# import yang terhapus atau variabel yang tidak ada bisa lolos typecheck
# & build, lalu baru ketahuan di produksi saat semua endpoint 502 karena
# proses Node gagal start. Script ini menangkap kelas bug tersebut.
#
# Pakai:
#   bash scripts/smoke-test.sh
#   SMOKE_PORT=6099 bash scripts/smoke-test.sh
#
# Exit code 0 = lolos, 1 = gagal (server tidak bisa melayani request).
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SMOKE_PORT="${SMOKE_PORT:-6099}"
LOG="${SMOKE_LOG:-/tmp/arkxmotion-smoke.log}"
WAIT_SECONDS="${SMOKE_WAIT:-45}"
ENDPOINTS="${SMOKE_ENDPOINTS:-/api/health /api/public/maintenance}"

# PID yang sedang LISTEN di sebuah port (Windows & Linux).
port_pid() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null | head -1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  else
    netstat -ano 2>/dev/null | grep ":$port " | grep -i "listening" | awk '{print $NF}' | head -1
  fi
}

# Matikan proses beserta anak-anaknya — di Windows `kill` biasa hanya
# membunuh `npx`, sementara proses `node` sebenarnya tetap hidup.
kill_tree() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 0
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  else
    kill -9 "$pid" 2>/dev/null || true
  fi
}

fail() {
  echo ""
  echo "❌ SMOKE TEST GAGAL: $1"
  echo "--- 40 baris terakhir log server ---"
  tail -40 "$LOG" 2>/dev/null || echo "(log kosong)"
  exit 1
}

LAUNCHER=""
cleanup() {
  kill_tree "$LAUNCHER"
  kill_tree "$(port_pid "$SMOKE_PORT")"
}
trap cleanup EXIT INT TERM

echo "🧪 Smoke test — port $SMOKE_PORT"

# ── Pre-check: pastikan port benar-benar bebas ────────────────
# Kalau ada server lama yang tertinggal, tes bisa "lolos" padahal server
# baru gagal start (false pass). Jadi bereskan dulu sampai port kosong.
for _ in $(seq 1 10); do
  existing="$(port_pid "$SMOKE_PORT")"
  [ -z "$existing" ] && break
  echo "   ⚠️  Port $SMOKE_PORT dipakai PID $existing — membereskan..."
  kill_tree "$existing"
  sleep 2
done
[ -z "$(port_pid "$SMOKE_PORT")" ] || fail "port $SMOKE_PORT masih terpakai, tidak bisa tes dengan bersih"

rm -f "$LOG"

# NODE_ENV=production menyalakan jalur static-file + SPA fallback yang
# dipakai di VPS, jadi yang diuji memang konfigurasi produksi.
NODE_ENV=production PORT="$SMOKE_PORT" npx tsx server/index.ts > "$LOG" 2>&1 &
LAUNCHER=$!

# ── Tunggu sampai melayani request ────────────────────────────
# Kegagalan startup = launcher mati DAN port tidak ada yang menempati.
ready=0
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$LAUNCHER" 2>/dev/null && [ -z "$(port_pid "$SMOKE_PORT")" ]; then
    sleep 1  # beri waktu log ter-flush
    fail "server keluar saat startup tanpa melayani request"
  fi
  sleep 1
done

[ "$ready" -eq 1 ] || fail "server tidak merespons /api/health dalam ${WAIT_SECONDS}s"

# ── Cek endpoint: harus ada respons, bukan 502/hang ───────────
for ep in $ENDPOINTS; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "http://127.0.0.1:$SMOKE_PORT$ep" || echo "000")
  case "$code" in
    000|502) fail "$ep mengembalikan HTTP $code" ;;
    *) echo "   ✓ HTTP $code  $ep" ;;
  esac
done

echo ""
echo "✅ SMOKE TEST LOLOS — server boot & melayani request"
