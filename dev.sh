#!/usr/bin/env bash
#
# dev.sh — satu titik masuk untuk mengerjakan workspace ini:
#
#   1. rapikan log sesi dev/preview yang sudah mati (tidy-logs.sh),
#   2. verifikasi hal yang sudah pernah memakan waktu — port backend harus sama
#      dengan target proxy Vite /api, `node_modules` jangan hilang, dan port
#      tujuan jangan sudah terisi,
#   3. jalankan `npm run dev:all` di `arkxmotion-studio/`, dengan seluruh output
#      ikut tersimpan di `scratch/logs/dev-<stamp>.log`.
#
# Jadi tidak ada lagi perapian yang harus diingat, dan log sesi baru tidak
# menumpuk di `.freebuff/`.
#
# Pemakaian:
#   ./dev.sh                  # perapian + cek + jalankan
#   ./dev.sh --dry-run        # cek saja, server tidak dijalankan
#   ./dev.sh --no-tidy        # lewati perapian log (awal dan akhir)
#   ./dev.sh --api-port 6000  # paksa port backend
#   ./dev.sh --respect-env    # pakai PORT dari `.env` apa adanya
#   ./dev.sh --force          # lanjut walau port tujuan sudah dipakai
#   ./dev.sh -- --host        # teruskan argumen setelah `--` ke npm
#
# Catatan: port backend diambil dari target proxy Vite dan diekspor sebagai
# `PORT` untuk proses anak. `server/index.ts` memanggil `dotenv.config()` tanpa
# `override`, jadi nilai dari shell menang atas `.env`. Cara itu dulu dipakai
# untuk menambal selisih `.env` (3001) vs proxy (6000); sekarang `.env` sudah
# 6000 dan fungsinya tinggal sebagai jaring pengaman kalau `.env` berubah lagi.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$ROOT/arkxmotion-studio"
LOGDIR="$ROOT/scratch/logs"

TIDY=1
DRY_RUN=0
FORCE=0
RESPECT_ENV=0
API_PORT=""
NPM_ARGS=()
TIDY_LOG="$(mktemp 2>/dev/null || echo /tmp/tidy-logs.$$.log)"

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)      DRY_RUN=1 ;;
    --no-tidy)      TIDY=0 ;;
    --force)        FORCE=1 ;;
    --respect-env)  RESPECT_ENV=1 ;;
    --api-port)     shift; API_PORT="${1:-}" ;;
    --)             shift; NPM_ARGS=("$@"); break ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "Opsi tidak dikenal: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ── 1. Perapian log sesi yang sudah mati ─────────────────────────────────────
if [ "$TIDY" -eq 1 ]; then
  if [ -x "$ROOT/tidy-logs.sh" ] || [ -f "$ROOT/tidy-logs.sh" ]; then
    echo "── Merapikan log sesi lama ──"
    # Gagal merapikan bukan alasan untuk menahan dev server: cukup dilaporkan,
    # dan barisnya dirapikan jadi satu ringkasan supaya tidak menenggelamkan
    # output server.
    if bash "$ROOT/tidy-logs.sh" >"$TIDY_LOG" 2>&1; then
      tail -1 "$TIDY_LOG"
    else
      echo "  (perapian log dilewati — lihat $TIDY_LOG)"
    fi
    echo
  fi
fi

# ── 2. Pemeriksaan awal ──────────────────────────────────────────────────────
PROBLEMS=()
NOTES=()
OK_LINES=()

if [ ! -d "$PRODUCT" ]; then
  echo "Folder produk tidak ada: $PRODUCT" >&2
  exit 1
fi

# Target proxy Vite untuk /api — inilah port yang benar-benar dipakai app.
PROXY_PORT="$(grep -oE "target: *'http://localhost:[0-9]+'" "$PRODUCT/vite.config.ts" 2>/dev/null \
  | head -1 | grep -oE '[0-9]+$')"
PROXY_PORT="${PROXY_PORT:-6000}"

# PORT dari .env, kalau ada.
ENV_PORT=""
if [ -f "$PRODUCT/.env" ]; then
  ENV_PORT="$(grep -E '^[[:space:]]*PORT=' "$PRODUCT/.env" | head -1 | grep -oE '[0-9]+')"
fi

# Port backend kalau tidak ada yang menimpa: PORT dari `.env`, atau default di
# server/index.ts (`Number(process.env.PORT) || 6000`) kalau `.env` diam soal itu.
SERVER_DEFAULT_PORT=6000
ENV_EFFECTIVE_PORT="${ENV_PORT:-$SERVER_DEFAULT_PORT}"
ENV_PORT_SOURCE="$([ -n "$ENV_PORT" ] && echo 'dari .env' || echo 'default server')"

# Pemeriksaan intinya: port backend harus sama dengan target proxy Vite /api.
# Kalau tidak sama, app terlihat jalan tapi setiap permintaan /api akan gagal
# tersambung — persis jebakan yang dulu membuat `.env` disetel ke 6000.
MISMATCH=0
[ "$ENV_EFFECTIVE_PORT" != "$PROXY_PORT" ] && MISMATCH=1

if [ "$RESPECT_ENV" -eq 1 ]; then
  WANT_PORT="$ENV_EFFECTIVE_PORT"
else
  WANT_PORT="$PROXY_PORT"
fi
[ -n "$API_PORT" ] && WANT_PORT="$API_PORT"

if [ "$MISMATCH" -eq 1 ]; then
  PROBLEMS+=("Port backend tidak cocok dengan proxy Vite /api: $ENV_EFFECTIVE_PORT ($ENV_PORT_SOURCE) vs $PROXY_PORT (vite.config.ts).")
  PROBLEMS+=("Perbaiki akarnya dengan menyetel PORT=$PROXY_PORT di arkxmotion-studio/.env, bukan lewat opsi skrip ini.")
  if [ "$RESPECT_ENV" -eq 1 ]; then
    PROBLEMS+=("--respect-env dipakai, jadi .env diikuti apa adanya dan permintaan /api tidak akan sampai ke backend.")
  else
    NOTES+=("Backend dijalankan dengan PORT=$WANT_PORT (nilai dari shell menang atas dotenv) supaya app tetap tersambung.")
  fi
elif [ -n "$API_PORT" ] && [ "$API_PORT" != "$PROXY_PORT" ]; then
  NOTES+=("--api-port $API_PORT: backend sengaja dipindah, padahal proxy Vite menunjuk ke $PROXY_PORT.")
else
  OK_LINES+=("port backend cocok dengan proxy Vite /api: $PROXY_PORT ($ENV_PORT_SOURCE)")
fi

# Port yang dipakai Vite (tidak diatur di vite.config.ts → 5173).
APP_PORT="$(grep -oE 'port: *[0-9]+' "$PRODUCT/vite.config.ts" 2>/dev/null | head -1 | grep -oE '[0-9]+')"
APP_PORT="${APP_PORT:-5173}"

port_pid() {
  netstat -ano 2>/dev/null | awk -v p=":$1" \
    '$1 ~ /TCP/ && $2 ~ (p "$") && $4 == "LISTENING" { print $5; exit }'
}

# Format default `tasklist` dipakai (bukan /FO CSV) karena di lingkungan ini
# flag format/filter tidak menghasilkan apa-apa. Kolom ke-2 adalah PID.
port_owner() {
  local pid="$1"
  command -v tasklist >/dev/null 2>&1 || return 0
  tasklist 2>/dev/null | awk -v p="$pid" '$2 == p { print $1; exit }'
}

busy_line() { # $1 = port, $2 = label — cetak baris kalau port terpakai
  local pid owner
  pid="$(port_pid "$1")"
  [ -z "$pid" ] && return 1
  owner="$(port_owner "$pid")"
  printf '  port %s (%s) sudah dipakai: PID %s%s\n' "$1" "$2" "$pid" "${owner:+ ($owner)}"
  return 0
}

if [ ! -d "$PRODUCT/node_modules" ]; then
  NOTES+=("node_modules belum ada — menjalankan npm install lebih dulu.")
fi

BUSY=0
BUSY_LINES=()
for entry in "$WANT_PORT|backend" "$APP_PORT|Vite"; do
  line="$(busy_line "${entry%%|*}" "${entry##*|}")" && BUSY=1
  [ -n "$line" ] && BUSY_LINES+=("$line")
done
if [ "$BUSY" -eq 1 ]; then
  PROBLEMS+=("Port di atas sudah terisi. Vite akan pindah port sendiri, tapi backend akan gagal dengan EADDRINUSE.")
  PROBLEMS+=("Matikan sesi lama, pakai --api-port <lain>, atau --force kalau memang itu yang diinginkan.")
fi

# `${arr[@]+...}` dipakai supaya aman di `set -u` untuk array kosong, termasuk
# di bash 3 (macOS) yang masih menganggapnya variabel tak terdefinisi.
for o in ${OK_LINES[@]+"${OK_LINES[@]}"}; do echo "ok: $o"; done
for n in ${NOTES[@]+"${NOTES[@]}"}; do echo "catatan: $n"; done
for l in ${BUSY_LINES[@]+"${BUSY_LINES[@]}"}; do echo "$l"; done
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo
  for p in ${PROBLEMS[@]+"${PROBLEMS[@]}"}; do echo "PERINGATAN: $p"; done
fi
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "── Rencana (dry-run, server tidak dijalankan) ──"
  echo "  produk   : $PRODUCT"
  echo "  perintah : npm run dev:all${NPM_ARGS[*]:+ ${NPM_ARGS[*]}}"
  echo "  dry-run  : server tidak dijalankan, tidak ada port yang diubah"
  echo "  PORT     : $WANT_PORT   (proxy Vite /api -> $PROXY_PORT, .env -> ${ENV_PORT:-<tanpa PORT>})"
  if [ "$MISMATCH" -eq 1 ]; then
    echo "             .env vs proxy: TIDAK COCOK (backend $ENV_EFFECTIVE_PORT vs proxy $PROXY_PORT)"
  else
    echo "             .env vs proxy: cocok"
  fi
  echo "  backend  : http://localhost:$WANT_PORT"
  echo "  app      : http://localhost:$APP_PORT"
  echo "  log      : $LOGDIR/dev-<tanggal>-<jam>.log"
  [ "$BUSY" -eq 1 ] && echo "  catatan  : port di atas terisi, jalankan tanpa --dry-run akan gagal di backend"
  exit 0
fi

if [ "$BUSY" -eq 1 ] && [ "$FORCE" -eq 0 ]; then
  echo "Dibatalkan karena port sudah terisi. Pakai --force untuk tetap mencoba." >&2
  exit 1
fi

# ── 3. Jalankan dev server ───────────────────────────────────────────────────
mkdir -p "$LOGDIR"
LOG="$LOGDIR/dev-$(date +%Y%m%d-%H%M%S).log"

if [ ! -d "$PRODUCT/node_modules" ]; then
  echo "── npm install (node_modules belum ada) ──"
  ( cd "$PRODUCT" && npm install ) || { echo "npm install gagal." >&2; exit 1; }
  echo
fi

echo "── Menjalankan dev server ──"
echo "  backend : http://localhost:$WANT_PORT"
echo "  app     : http://localhost:$APP_PORT"
echo "  log     : scratch/logs/$(basename "$LOG")"
echo "  berhenti: Ctrl+C"
echo

( cd "$PRODUCT" && PORT="$WANT_PORT" npm run dev:all ${NPM_ARGS[@]+"${NPM_ARGS[@]}"} ) 2>&1 | tee "$LOG"
status="${PIPESTATUS[0]}"

echo
echo "Dev server berhenti (exit $status). Output: scratch/logs/$(basename "$LOG")"

# ── 4. Perapian penutup ──────────────────────────────────────────────────────
if [ "$TIDY" -eq 1 ] && [ -f "$ROOT/tidy-logs.sh" ]; then
  if bash "$ROOT/tidy-logs.sh" >"$TIDY_LOG" 2>&1; then
    echo "Log sesi yang sudah mati: $(tail -1 "$TIDY_LOG")"
  fi
fi

rm -f "$TIDY_LOG" 2>/dev/null
exit "$status"
