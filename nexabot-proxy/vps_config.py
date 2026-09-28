"""Kredensial VPS untuk skrip di folder nexabot-proxy.

Sejajar dengan `arkxmotion-studio/deploy_config.py`, tapi sengaja BERDIRI
SENDIRI: dua folder ini aplikasi yang berbeda, jadi clone nexabot-proxy harus
tetap jalan tanpa membawa folder tetangganya.

Kredensial tidak boleh ditanam di dalam skrip mana pun. Semua skrip di folder ini
(deploy-vps.py, _setup-monitor.py, fix-deploy.py) mengimpor modul ini, jadi:

  • hanya ada SATU sumber kebenaran — `.env` (di-ignore git) atau environment;
  • kunci baru cukup ditambahkan di satu tempat, dan didokumentasikan di
    `.env.example` supaya clone baru tahu apa yang harus diisi;
  • skrip berhenti dengan pesan jelas kalau kredensial belum lengkap, alih-alih
    memakai nilai bawaan yang bisa mengarah ke server yang salah.

Prioritas: environment > `.env`, sehingga nilai bisa ditimpa sementara tanpa
mengubah berkas:

    VPS_HOST=10.0.0.2 python deploy-vps.py --check

Modul ini juga memuat helper koneksi dan jalur `--check`, supaya ketiga skrip
membagi satu kebijakan yang sama dan tidak masing-masing punya salinannya.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REMOTE_DIR = '/home/arkxmotion/nexabot-proxy'


def load_env_file(path: str) -> dict[str, str]:
    """Baca `KUNCI=nilai` dari berkas .env sederhana; berkas tak ada = kosong."""
    values: dict[str, str] = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            values[key.strip()] = val.strip().strip('"').strip("'")
    return values


ENV = {**load_env_file(os.path.join(ROOT, '.env')), **os.environ}

REQUIRED = ('VPS_HOST', 'VPS_USER', 'VPS_PASSWORD')


def cfg(key: str, default: str = '') -> str:
    """Nilai satu kunci; string kosong dianggap belum diisi."""
    return ENV.get(key) or default


def vps_config() -> dict[str, object]:
    """Kredensial + tujuan deploy. Berhenti dengan pesan jelas bila kurang.

    Tidak pernah mencetak nilai kredensial — hanya nama kunci yang kosong.
    """
    missing = [key for key in REQUIRED if not cfg(key)]
    if missing:
        print('[X] Kredensial VPS belum lengkap: ' + ', '.join(missing))
        print('[X] Isi di berkas ini, lalu jalankan lagi:')
        print('    ' + os.path.join(ROOT, '.env'))
        print('    Tidak ada nilai bawaan yang dipakai diam-diam.')
        sys.exit(1)

    try:
        port = int(cfg('VPS_PORT', '22'))
    except ValueError:
        print('[X] VPS_PORT bukan angka: ' + repr(cfg('VPS_PORT')))
        sys.exit(1)

    return {
        'host': cfg('VPS_HOST'),
        'port': port,
        'user': cfg('VPS_USER'),
        'password': cfg('VPS_PASSWORD'),
        # Default = folder tempat modul ini berada, jadi tidak ada path mesin
        # yang tertanam di skrip.
        'local_dir': cfg('VPS_LOCAL_DIR', ROOT),
        'remote_dir': cfg('VPS_REMOTE_DIR', DEFAULT_REMOTE_DIR),
    }


def ssh_connect(conf: dict | None = None):
    """Buka SSH ke VPS memakai kredensial dari `.env`.

    `allow_agent` dan `look_for_keys` dimatikan dengan sengaja: koneksi harus
    berhasil karena kredensial di `.env`, bukan karena kebetulan ada kunci SSH
    di mesin ini. Kegagalan yang jelas lebih berguna daripada keberhasilan yang
    tidak bisa dijelaskan — dan kunci diam-diam itu yang membuat skrip tampak
    benar di laptop sendiri lalu gagal di tempat lain.
    """
    import paramiko

    conf = conf or vps_config()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(conf['host'], port=conf['port'], username=conf['user'],
              password=conf['password'], timeout=15,
              allow_agent=False, look_for_keys=False)
    return c


def run_check(conf: dict | None = None) -> None:
    """Jalur `--check`: buktikan kredensial valid tanpa mengubah apa pun.

    Ditambahkan supaya pemindahan kredensial ke `.env` bisa diuji sungguhan —
    tersambung ke server yang benar — tanpa mengunggah berkas, tanpa me-restart
    layanan, dan tanpa menyentuh database produksi.
    """
    conf = conf or vps_config()
    print(f'[..] {conf["user"]}@{conf["host"]}:{conf["port"]} (kredensial dari .env)')
    c = ssh_connect(conf)
    _, out, _ = c.exec_command('hostname; uptime -p 2>/dev/null || uptime', timeout=10)
    text = out.read().decode('utf-8', errors='replace').strip()
    c.close()
    for line in text.splitlines():
        print('  ' + line)
    print('[OK] Kredensial valid — tidak ada berkas yang diunggah, tidak ada layanan di-restart.')
    sys.exit(0)
