#!/usr/bin/env bash
#
# check.sh — satu perintah pemeriksaan untuk workspace ini:
#
#   1. konfigurasi — `PORT` di `.env` harus cocok dengan `.env.example` dan
#      dengan target proxy `/api` di `vite.config.ts`, dan setiap kunci di
#      `.env` harus terdokumentasi di `.env.example`;
#   2. kredensial literal — berkas yang akan di-commit tidak boleh memuat nilai
#      rahasia yang ditulis apa adanya (password, token, kunci API). Nilai itu
#      harus dibaca dari environment atau `.env` yang di-ignore git;
#   3. tes — `test-scripts.sh` di sandbox (tidak menyentuh berkas asli);
#   4. typecheck repo produk — `npm run typecheck:backend`.
#
# Pemakaian:
#   ./check.sh                    # semua fase
#   ./check.sh --staged           # hanya yang relevan dengan berkas staged (dipakai hook)
#   ./check.sh --config-only      # fase konfigurasi saja
#   ./check.sh --no-secrets       # lewati fase kredensial
#   ./check.sh --no-tests         # lewati fase tes
#   ./check.sh --no-typecheck     # lewati fase typecheck
#   ./check.sh --install-hook     # pasang pre-commit hook di repo workspace
#   ./check.sh --install-hook --product   # ... dan di repo produk juga
#   ./check.sh --uninstall-hook [--product]
#   ./check.sh --help
#
# Fase 1 dan 2 selalu jalan pada mode `--staged` (biayanya di bawah satu detik)
# karena kelas kesalahan yang dijaganya tidak terlihat dari tes mana pun: port
# backend yang tidak cocok dengan proxy Vite baru ketahuan saat `/api` gagal,
# dan kredensial yang tercatat di git baru ketahuan setelah repo dibagikan —
# di sini pernah terjadi dua kali, password VPS tertanam di dua skrip deploy dan
# password bawaan di dalam skrip seed akun demo.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$ROOT/arkxmotion-studio"
SERVER_DEFAULT_PORT=6000

# Penanda hook yang dipasang check.sh. Dipakai untuk mengenali hook sendiri —
# mencocokkan nama "check.sh" saja tidak cukup, karena hook orang lain pun bisa
# menyebut nama itu di komentarnya.
HOOK_MARKER='penanda: check.sh-hook'

RUN_CONFIG=1
RUN_SECRETS=1
RUN_TESTS=1
RUN_TYPECHECK=1
STAGED=0
FORCE=0
ACTION="check"
ALSO_PRODUCT=0

FAILED=()
CREDENTIAL_HITS=0
AUDIT_HITS=0

# Blok docblock diambil dari awal sampai baris komentar terakhir, bukan lewat
# nomor baris yang harus diperbarui setiap kali dokumentasinya tumbuh — versi
# lama memakai '3,26p' dan ikut menampilkan `set -u` di akhir bantuan.
usage() { sed -n '3,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)       STAGED=1 RUN_TESTS=0 RUN_TYPECHECK=0 ;;
    --config-only)  RUN_SECRETS=0 RUN_TESTS=0 RUN_TYPECHECK=0 ;;
    --no-secrets)   RUN_SECRETS=0 ;;
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

# ── 2. Kredensial literal ───────────────────────────────────────────────────
# Yang dicari: nilai rahasia yang DITULIS di berkas. Yang bukan: nilai yang
# hanya dirujuk (`process.env.X`, `${VAR}`), kolom kosong, dan contoh di
# dokumentasi.
#
# Dipisah dua kali `git grep` karena pola prefiks kunci provider peka huruf
# besar-kecil (`AKIA…`, `github_pat_…`) sementara nama variabel tidak
# (`Password=`, `API_KEY=`). Mode staged memakai `git grep --cached`, yang
# memeriksa ISI INDEX — persis yang akan masuk commit — bukan isi worktree, jadi
# coretan lokal yang belum di-stage tidak ikut dinilai.
CREDENTIAL_NAME='(PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)'

# Berkas yang memang boleh memuat pola itu: check.sh dan tesnya memuat contoh
# polanya sendiri, dan lockfile penuh hash (yang bukan rahasia apa pun).
CREDENTIAL_EXCLUDE=(-- . ':!check.sh' ':!test-scripts.sh' ':!package-lock.json' ':!*.lock' ':!*.min.js' ':!*.map')

# Nilai yang bukan rahasia: rujukan ke environment, placeholder, dan contoh.
#
# Dipisah dua daftar, dan itu penting: kata seperti "example"/"sample"/"contoh"
# hanya boleh membungkam pola NAMA KUNCI, bukan pola kuat (private key, prefiks
# provider, JWT, connection string). Alasannya konkret: saat daftarnya satu,
# `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE` ikut lolos — bukan karena contoh,
# melainkan karena kata "EXAMPLE" ada di dalam nilainya, dan nama variabel apa
# pun bisa kebetulan memuatnya. Yang dikecualikan secara khusus hanyalah nilai
# contoh resmi AWS, yang memang muncul di dokumentasi mereka.
CREDENTIAL_ALLOW_STRONG='(\$\(|\$\{|\$[A-Za-z_][A-Za-z0-9_]*|<[A-Za-z0-9_-]+>|process\.env|import\.meta\.env|os\.environ|getenv|your[_-]|xxx+|placeholder|redacted|dummy|todo|kredensial-ok|AIza[A-Za-z0-9_-]{10,}|AKIAIOSFODNN7EXAMPLE|Iiwicm9sZSI6ImFub24i)'
CREDENTIAL_ALLOW_NAMED="${CREDENTIAL_ALLOW_STRONG%?}|changeme|change[_-]?me|invalid|example|sample|contoh|ubah-saya)"

# Pola dijalankan pada baris yang sudah berawalan `berkas:baris:` — bentuk yang
# sama dengan keluaran git grep, dan bentuk yang dibaca pelapor. Pola `^`-nya
# ditulis untuk ISI baris, jadi awalannya boleh ada, bukan wajib; tanpa ini pola
# yang ber-anchor (`^VPS_PASSWORD=`) tidak akan pernah cocok lagi begitu
# pemindaian berhenti memakai git grep. Berkas yang namanya memuat titik dua
# tidak dikenali awalannya — itu hanya membuat pola ini jatuh ke perilaku lama.
CREDENTIAL_LINE_PREFIX='([^:]*:[0-9]+:)?'

credential_patterns_exact() {
  cat <<'PATTERNS'
-----BEGIN [A-Z ]*PRIVATE KEY-----
://[^[:space:]/]+:[^[:space:]@/]{6,}@
[A-Za-z0-9_](sk|ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}
AKIA[0-9A-Z]{16}
xox[baprs]-[A-Za-z0-9-]{10,}
eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.
PATTERNS
}

# Nilai rahasia TIDAK mengandung spasi: yang berspasi itu potongan kode atau
# prosa. Karena itu pola nama-kunci mensyaratkan nilai tanpa spasi, dan nilainya
# baru dianggap rahasia kalau memuat angka atau panjang dan acak (>= 24
# karakter). Tanpa syarat itu, `credentials: 'include'`, `'client-master'`, dan
# `TOKEN_KEY = 'arkxmotion_token'` ikut ditandai hanya karena nama variabelnya
# menyebut kredensial.
#
# Syaratnya memakai ANGKA, bukan huruf besar, dan itu bukan selera: aliran ini
# dijalankan dengan -i supaya nama seperti `accessToken` ikut terbaca, dan di
# bawah -i kelas `[A-Z]` juga cocok dengan huruf kecil — sehingga versi pertama
# yang bersyarat "ada huruf besar" sebenarnya tidak menyaring apa pun.
# Syaratnya juga ditulis DI DALAM pola, bukan lewat `grep -E` terpisah pada baris
# yang sama: pada `fetch(url, { method: 'GET', credentials: 'include' })`,
# potongan `'GET'` memuaskan saringan baris walau nilai yang dicurigai cuma
# 'include'.
credential_patterns_quoted() { # $1 = kelas kutip
  printf '%s\n' \
    "[A-Za-z0-9_]*${CREDENTIAL_NAME}[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*[${1}]([^${1}[:space:]]*[0-9][^${1}[:space:]]*|[^${1}[:space:]]{24,})[${1}]"
}

# Bentuk kedua: berkas gaya `.env`/config. Kuncinya wajib HURUF BESAR
# (`VPS_PASSWORD=`), sehingga penugasan variabel di kode — `accessToken =
# refreshed.accessToken`, `tokens = filtered.slice(0, 10)` — tidak ikut masuk.
# Karena itu pula pola ini dijalankan TANPA -i.
credential_patterns_env() { # $1 = kelas kutip
  printf '%s\n' "^${CREDENTIAL_LINE_PREFIX}[[:space:]]*(export[[:space:]]+)?[A-Z][A-Z0-9_]*${CREDENTIAL_NAME}[A-Z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]${1}]{8,}"
}

# Penyaring daftar izin menilai ISI baris, bukan seluruh baris keluaran git grep.
# Keluaran git grep diawali `berkas:baris:`, dan nama berkas kerap memuat kata
# yang ada di daftar izin — `test/contoh.test.ts`, `docs/example-config.md`,
# `.env.sample`. Kalau seluruh baris yang disaring, kredensial nyata di dalam
# berkas ber-nama begitu ikut terbuang: lubang tepat di tempat yang paling
# sering menampung nilai contoh, dan sekaligus tempat orang menaruh yang asli.
credential_allow_filter() { # $1 = regex izin; stdin = baris `berkas:baris:isi`
  local re="$1" line rest content
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    rest="${line#*:}"        # buang `berkas:`
    content="${rest#*:}"     # buang `baris:`
    printf '%s' "$content" | grep -qiE "$re" || printf '%s\n' "$line"
  done
  return 0
}

# Baris yang diperiksa, dalam bentuk `berkas:baris:isi` (sama seperti keluaran
# git grep) supaya penilai pola dan pelapor tidak perlu tahu asal-usulnya.
#
# Mode staged menilai BARIS YANG DITAMBAHKAN saja. Di sinilah letak bedanya dari
# `git grep --cached`, yang membaca SELURUH index — termasuk berkas yang tidak
# ikut di-commit. Karena repo ini sudah memuat kredensial lama yang ter-commit,
# versi itu akan memblokir setiap commit berikutnya sampai semuanya dibersihkan;
# gerbang yang selalu menyala sama tidak bergunanya dengan gerbang yang mati,
# dan yang paling sering terjadi adalah orang melepasnya dengan --no-secrets.
# Yang diperiksa karena itu persis yang diminta: berkas baru (seluruh barisnya)
# dan baris baru di berkas yang diubah.
credential_lines() { # $1 = repo, $2 = staged|tracked
  local repo="$1" mode="$2"
  if [ "$mode" = staged ]; then
    # `--unified=0` membuang konteks; sisanya dinormalkan ke `berkas:baris:isi`,
    # jadi nomor baris tetap menunjuk ke berkas aslinya, bukan ke nomor baris diff.
    git -C "$repo" diff --cached --unified=0 --no-color --diff-filter=ACMR \
      "${CREDENTIAL_EXCLUDE[@]}" 2>/dev/null | awk '
        /^\+\+\+ b\// { file = substr($0, 7); next }
        /^@@/ {
          split($0, head, "+"); split(head[2], num, ","); ln = num[1] - 1
          next
        }
        /^\+/ { ln++; printf "%s:%d:%s\n", file, ln, substr($0, 2); next }
        /^ /  { ln++ }
      '
  else
    git -C "$repo" grep -I -n -E -e "" "${CREDENTIAL_EXCLUDE[@]}" 2>/dev/null || true
  fi
}

credential_scan() { # $1 = repo, $2 = staged|tracked
  local repo="$1" mode="$2" lines
  # Kutip ganda dan tunggal dibangun lewat printf supaya polanya bisa ditulis
  # dalam satu string tanpa lapisan escape yang tidak terbaca.
  local Q; Q="$(printf '\x22\x27')"
  local exact=() quoted=() env_assign=() p
  while IFS= read -r p; do [ -n "$p" ] && exact+=(-e "$p"); done <<< "$(credential_patterns_exact)"
  while IFS= read -r p; do [ -n "$p" ] && quoted+=(-e "$p"); done <<< "$(credential_patterns_quoted "$Q")"
  while IFS= read -r p; do [ -n "$p" ] && env_assign+=(-e "$p"); done <<< "$(credential_patterns_env "$Q")"

  lines="$(credential_lines "$repo" "$mode")"
  [ -n "$lines" ] || return 0
  {
    printf '%s\n' "$lines" | grep -E "${exact[@]}" \
      | credential_allow_filter "$CREDENTIAL_ALLOW_STRONG"
    printf '%s\n' "$lines" | grep -iE "${quoted[@]}" \
      | credential_allow_filter "$CREDENTIAL_ALLOW_NAMED"
    printf '%s\n' "$lines" | grep -E "${env_assign[@]}" \
      | credential_allow_filter "$CREDENTIAL_ALLOW_NAMED"
  } | sort -u
}

# Nilai rahasianya sengaja TIDAK pernah dicetak — hanya nama kunci dan
# lokasinya. Keluaran hook masuk ke terminal dan log; rahasia yang tercetak di
# sana ikut tercatat lagi di tempat baru, yang justru masalah yang dicegah.
credential_report() { # $1 = repo, $2 = label, $3 = staged|tracked
  local repo="$1" label="$2" mode="$3" hits entry file rest lineno key is_test
  if [ ! -d "$repo/.git" ]; then
    note "$label: bukan repo git — dilewati"
    return 0
  fi
  hits="$(credential_scan "$repo" "$mode")"
  if [ -z "$hits" ]; then
    if [ "$mode" = staged ]; then
      ok "$label: tidak ada kredensial literal di baris yang di-stage"
    else
      ok "$label: tidak ada kredensial literal di berkas ter-track"
    fi
    return 0
  fi
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    file="${entry%%:*}"; rest="${entry#*:}"; lineno="${rest%%:*}"; rest="${rest#*:}"
    key="$(printf '%s' "$rest" | sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+)[[:space:]]*[=:].*/\2/p')"
    # Berkas tes memang memuat nilai palsu dengan sengaja (JWT contoh, kunci
    # main-main). Ditandai sebagai catatan, bukan kegagalan: kalau ikut
    # memblokir, orang akan mematikan fase ini dengan --no-secrets dan seluruh
    # penjagaannya hilang — persis kegagalan yang ingin dihindari.
    case "$file" in
      test/*|*/test/*|*/__tests__/*|*.test.*|test-*|*-test.*) is_test=1 ;;
      *) is_test=0 ;;
    esac
    if [ "$is_test" -eq 1 ]; then
      note "$label: $file:$lineno — kredensial literal di berkas tes (tidak memblokir)"
      continue
    fi
    # Mode audit (seluruh repo) hanya melaporkan: temuan di sana hampir selalu
    # kredensial yang sudah lama ter-commit, dan memblokir karenanya membuat
    # setiap `./check.sh` gagal tanpa ada yang bisa memperbaikinya dari commit
    # itu. Yang memblokir adalah mode staged, tepat saat nilainya mau masuk.
    if [ "$mode" = tracked ]; then
      note "$label: $file:$lineno — kredensial literal sudah ter-commit (audit, tidak memblokir)"
      AUDIT_HITS=$((AUDIT_HITS + 1))
      continue
    fi
    if [ -n "$key" ]; then
      fail "$label: $file:$lineno — nilai rahasia tertulis di kunci $key"
    else
      fail "$label: $file:$lineno — pola kunci/token terdeteksi"
    fi
    CREDENTIAL_HITS=$((CREDENTIAL_HITS + 1))
  done <<< "$hits"
  return 0
}

credentials_phase() {
  printf '\n── 2. Kredensial literal ──\n'
  local mode="tracked"
  [ "$STAGED" -eq 1 ] && mode="staged"
  CREDENTIAL_HITS=0
  AUDIT_HITS=0
  credential_report "$ROOT" "workspace" "$mode"
  credential_report "$PRODUCT" "repo produk" "$mode"
  if [ "$CREDENTIAL_HITS" -gt 0 ]; then
    note "nilainya sengaja tidak dicetak di sini"
    note "bacalah dari environment atau .env (di-ignore git) dan rujuk dari kode"
    note "bila nilainya memang publik (kunci klien), tandai barisnya dengan komentar: kredensial-ok"
  fi
  if [ "$AUDIT_HITS" -gt 0 ]; then
    note "$AUDIT_HITS temuan lama di repo (audit) — tidak memblokir; gerbang commit hanya menilai baris yang di-stage"
    note "pindahkan ke .env (di-ignore git) dan rujuk dari kode, atau tandai barisnya: kredensial-ok"
  fi
  return 0
}

# ── 3. Tes skrip ────────────────────────────────────────────────────────────
tests_phase() {
  printf '\n── 3. Tes skrip (sandbox) ──\n'
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

# ── 4. Typecheck repo produk ────────────────────────────────────────────────
typecheck_phase() {
  printf '\n── 4. Typecheck repo produk ──\n'
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

# Hook dianggap milik kita kalau punya penanda, atau memakai komentar versi lama
# (sebelum penanda ada) — supaya hook lama bisa dikenali dan di-upgrade, bukan
# ditolak sebagai hook asing.
is_our_hook() {
  grep -qE "penanda: check\.sh-hook|Dipasang oleh check\.sh" "$1" 2>/dev/null
}

install_hook() { # $1 = repo, $2 = label
  local repo="$1" label="$2"
  if [ ! -d "$repo/.git" ]; then
    fail "bukan repo git: $label ($repo)"
    return 0
  fi
  local hook; hook="$(hook_path "$repo")"
  mkdir -p "$(dirname "$hook")"
  if [ -e "$hook" ] && ! is_our_hook "$hook"; then
    if [ "$FORCE" -eq 1 ]; then
      cp "$hook" "$hook.backup-$(date +%Y%m%d-%H%M%S)"
      note "$label: hook lama disimpan sebagai $(basename "$hook").backup-*"
    else
      fail "$label: sudah ada pre-commit hook lain di $hook — pakai --force kalau memang ingin diganti"
      return 0
    fi
  fi
  # Selalu menunjuk check.sh milik workspace ($ROOT), bukan milik repo yang
  # dipasangi hook: check.sh hanya ada di root workspace, dan repo produk akan
  # butuh salinan yang ikut dirawat kalau ditunjuk ke dirinya sendiri.
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# $HOOK_MARKER — dipasang oleh check.sh ($ROOT)
# Periksa hal yang relevan dengan berkas yang di-stage.
exec "$ROOT/check.sh" --staged
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
  if is_our_hook "$hook"; then
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
    [ "$RUN_SECRETS" -eq 1 ] && credentials_phase
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
