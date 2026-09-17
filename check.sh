#!/usr/bin/env bash
#
# check.sh — satu perintah pemeriksaan untuk workspace ini:
#
#   1. konfigurasi — `PORT` di `.env` harus cocok dengan `.env.example` dan
#      dengan target proxy `/api` di `vite.config.ts`, dan setiap kunci di
#      `.env` harus terdokumentasi di `.env.example`;
#   2. tes — `test-scripts.sh` di sandbox (tidak menyentuh berkas asli);
#   3. typecheck repo produk — `npm run typecheck:backend`.
#
# Pemakaian:
#   ./check.sh                    # semua fase
#   ./check.sh --staged           # hanya yang relevan dengan berkas staged (dipakai hook)
#   ./check.sh --config-only      # fase konfigurasi saja
#   ./check.sh --no-tests         # lewati fase tes
#   ./check.sh --no-typecheck     # lewati fase typecheck
#   ./check.sh --install-hook     # pasang pre-commit hook di repo workspace
#   ./check.sh --install-hook --product   # ... dan di repo produk juga
#   ./check.sh --uninstall-hook [--product]
#   ./check.sh --help
#
# Fase 1 sengaja selalu jalan (biayanya di bawah satu detik) karena kelas
# kesalahan yang dijaganya — port backend tidak cocok dengan proxy Vite — tidak
# terlihat sampai ada permintaan `/api` yang gagal, dan pernah terjadi di sini.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$ROOT/arkxmotion-studio"
SERVER_DEFAULT_PORT=6000

RUN_CONFIG=1
RUN_TESTS=1
RUN_TYPECHECK=1
STAGED=0
FORCE=0
ACTION="check"
ALSO_PRODUCT=0

FAILED=()

usage() { sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)       STAGED=1 RUN_TESTS=0 RUN_TYPECHECK=0 ;;
    --config-only)  RUN_TESTS=0 RUN_TYPECHECK=0 ;;
    --no-tests)     RUN_TESTS=0 ;;
    --no-typecheck) RUN_TYPECHECK=0 ;;
    --install-hook)   ACTION="install" ;;
    --uninstall-hook) ACTION="uninstall" ;;
    --product)      ALSO_PRODUCT=1 ;;
    --force)        FORCE=1 ;;
    -h|--help)      usage; exit 0 ;;
    *) printf 'Opsi tidak dikenal: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

ok()   { printf '  ok     %s\n' "$1"; }
note() { printf '  catatan %s\n' "$1"; }
fail() { printf '  GAGAL  %s\n' "$1"; FAILED+=("$1"); }

# ── 1. Konfigurasi ──────────────────────────────────────────────────────────
# Port di vite.config.ts diambil lewat `sed`, bukan `grep -oE '[0-9]+$'`:
# teks yang cocok diakhiri tanda kutip atau koma, jadi pola berjangkar akhir
# gagal diam-diam dan nilainya cuma jatuh ke default.
proxy_port() {
  grep -oE "target: *'http://localhost:[0-9]+'" "$PRODUCT/vite.config.ts" 2>/dev/null \
    | head -1 | sed -n 's/.*localhost:\([0-9]\{1,\}\).*/\1/p'
}

env_value() { # $1 = nama kunci
  grep -E "^[[:space:]]*$1=" "$2" 2>/dev/null | head -1 | sed -n "s/^[^=]*=//p" | tr -d '\r'
}

env_keys() { # $1 = berkas
  grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$1" 2>/dev/null \
    | tr -d ' =' | tr -d '\r' | sort -u
}

config_phase() {
  printf '── 1. Konfigurasi lokal ──\n'

  local envf="$PRODUCT/.env"
  local examplef="$PRODUCT/.env.example"

  if [ ! -f "$envf" ]; then
    note "belum ada $envf — salin dari .env.example untuk memeriksa port"
  fi

  local proxy; proxy="$(proxy_port)"
  [ -n "$proxy" ] || proxy="$SERVER_DEFAULT_PORT"
  ok "proxy Vite /api menunjuk ke port $proxy"

  if [ -f "$envf" ]; then
    local env_port; env_port="$(env_value PORT "$envf")"
    if [ -z "$env_port" ]; then
      note "PORT tidak diisi di .env — server memakai default $SERVER_DEFAULT_PORT"
      env_port="$SERVER_DEFAULT_PORT"
    fi
    if [ "$env_port" = "$proxy" ]; then
      ok "PORT di .env ($env_port) cocok dengan proxy Vite"
    else
      fail "PORT di .env ($env_port) tidak cocok dengan proxy Vite ($proxy) — permintaan /api akan gagal tersambung"
    fi
  fi

  if [ -f "$examplef" ]; then
    local example_port; example_port="$(env_value PORT "$examplef")"
    if [ -n "$example_port" ]; then
      if [ "$example_port" = "$proxy" ]; then
        ok "PORT di .env.example ($example_port) cocok dengan proxy Vite"
      else
        fail "PORT di .env.example ($example_port) tidak cocok dengan proxy Vite ($proxy)"
      fi
    fi

    if [ -f "$envf" ]; then
      local undocumented=""
      local key
      while IFS= read -r key; do
        [ -n "$key" ] || continue
        grep -qE "^[[:space:]]*$key=" "$examplef" || undocumented="$undocumented $key"
      done <<< "$(env_keys "$envf")"
      if [ -z "$undocumented" ]; then
        ok "semua kunci di .env terdokumentasi di .env.example"
      else
        fail "kunci di .env belum ada di .env.example:$undocumented"
      fi
    fi
  else
    note "tidak ada .env.example — pemeriksaan dokumentasi kunci dilewati"
  fi
}

# ── 2. Tes skrip ────────────────────────────────────────────────────────────
tests_phase() {
  printf '\n── 2. Tes skrip (sandbox) ──\n'
  if [ ! -f "$ROOT/test-scripts.sh" ]; then
    note "test-scripts.sh tidak ada — dilewati"
    return 0
  fi
  local out; out="$(mktemp)"
  if bash "$ROOT/test-scripts.sh" > "$out" 2>&1; then
    ok "$(grep -E '^Lolos:' "$out" | tail -1)"
  else
    fail "test-scripts.sh gagal:"
    grep -E '^  GAGAL' "$out" | sed 's/^  /         /' | head -20
    grep -E '^Lolos:' "$out" | tail -1 | sed 's/^/         /'
  fi
  rm -f "$out"
}

# ── 3. Typecheck repo produk ────────────────────────────────────────────────
typecheck_phase() {
  printf '\n── 3. Typecheck repo produk ──\n'
  if [ ! -f "$PRODUCT/package.json" ]; then
    note "repo produk tidak ada di sini — dilewati"
    return 0
  fi
  local out; out="$(mktemp)"
  if ( cd "$PRODUCT" && npm run typecheck:backend ) > "$out" 2>&1; then
    ok "npm run typecheck:backend"
  else
    fail "npm run typecheck:backend gagal:"
    tail -25 "$out" | sed 's/^/         /'
  fi
  rm -f "$out"
}

# ── Mode --staged: pilih fase berdasarkan berkas yang di-stage ──────────────
select_phases_for_staged() {
  local ws_staged product_staged
  ws_staged="$(git -C "$ROOT" diff --cached --name-only 2>/dev/null || true)"
  product_staged="$(git -C "$PRODUCT" diff --cached --name-only 2>/dev/null || true)"

  if printf '%s\n' "$ws_staged" | grep -qE '\.sh$'; then
    RUN_TESTS=1
  fi
  if printf '%s\n' "$product_staged" | grep -qE '^(server|api)/|^package\.json$|^tsconfig.*\.json$'; then
    RUN_TYPECHECK=1
  fi

  printf 'Mode staged: tes %s, typecheck %s (fase konfigurasi selalu jalan)\n' \
    "$([ "$RUN_TESTS" -eq 1 ] && echo 'ya' || echo 'tidak')" \
    "$([ "$RUN_TYPECHECK" -eq 1 ] && echo 'ya' || echo 'tidak')"
}

# ── Pasang / lepas hook ─────────────────────────────────────────────────────
hook_path() { printf '%s/.git/hooks/pre-commit' "$1"; }

install_hook() { # $1 = repo, $2 = label
  local repo="$1" label="$2"
  if [ ! -d "$repo/.git" ]; then
    fail "bukan repo git: $label ($repo)"
    return 0
  fi
  local hook; hook="$(hook_path "$repo")"
  mkdir -p "$(dirname "$hook")"
  if [ -e "$hook" ] && ! grep -q 'check\.sh' "$hook" 2>/dev/null; then
    if [ "$FORCE" -eq 1 ]; then
      cp "$hook" "$hook.backup-$(date +%Y%m%d-%H%M%S)"
      note "$label: hook lama disimpan sebagai $(basename "$hook").backup-*"
    else
      fail "$label: sudah ada pre-commit hook lain di $hook — pakai --force kalau memang ingin diganti"
      return 0
    fi
  fi
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# Dipasang oleh check.sh — jalankan pemeriksaan yang relevan dengan berkas staged.
exec "$repo/check.sh" --staged
EOF
  chmod +x "$hook" 2>/dev/null
  ok "$label: pre-commit hook dipasang ($hook)"
}

uninstall_hook() { # $1 = repo, $2 = label
  local repo="$1" label="$2"
  local hook; hook="$(hook_path "$repo")"
  if [ ! -e "$hook" ]; then
    note "$label: tidak ada hook untuk dilepas"
    return 0
  fi
  if grep -q 'check\.sh' "$hook" 2>/dev/null; then
    rm -f "$hook"
    ok "$label: hook dilepas"
  else
    fail "$label: hook di $hook bukan buatan check.sh — tidak saya sentuh"
  fi
}

printf 'Pemeriksaan workspace — %s\n\n' "$ROOT"

case "$ACTION" in
  install)
    printf '── Memasang pre-commit hook ──\n'
    install_hook "$ROOT" "workspace"
    [ "$ALSO_PRODUCT" -eq 1 ] && install_hook "$PRODUCT" "repo produk"
    [ "$ALSO_PRODUCT" -eq 0 ] && printf '  catatan pasang juga di repo produk: ./check.sh --install-hook --product\n'
    ;;
  uninstall)
    printf '── Melepas pre-commit hook ──\n'
    uninstall_hook "$ROOT" "workspace"
    [ "$ALSO_PRODUCT" -eq 1 ] && uninstall_hook "$PRODUCT" "repo produk"
    ;;
  check)
    [ "$STAGED" -eq 1 ] && select_phases_for_staged
    [ "$RUN_CONFIG" -eq 1 ] && config_phase
    [ "$RUN_TESTS" -eq 1 ] && tests_phase
    [ "$RUN_TYPECHECK" -eq 1 ] && typecheck_phase
    ;;
esac

printf '\n────────────────────────────────────────\n'
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf 'ADA YANG GAGAL (%s):\n' "${#FAILED[@]}"
  for f in "${FAILED[@]}"; do printf -- '- %s\n' "$f"; done
  exit 1
fi
printf 'Semua pemeriksaan lolos.\n'
exit 0
