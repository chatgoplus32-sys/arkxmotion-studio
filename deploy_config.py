"""Konfigurasi & kredensial VPS untuk skrip deploy.

Kredensial TIDAK boleh ditanam di dalam skrip deploy mana pun. Semua skrip
(deploy_vps.py, _deploy_now.py) mengimpor modul ini, jadi:

  • hanya ada SATU sumber kebenaran — `.env` (di-ignore git) atau environment;
  • kunci baru cukup ditambahkan di satu tempat, dan didokumentasikan di
    `.env.example` (dijaga oleh check.sh pada pre-commit);
  • skrip berhenti dengan pesan jelas kalau kredensial belum lengkap, alih-alih
    memakai nilai bawaan yang bisa mengarah ke server yang salah.

Prioritas: environment > `.env`. Jadi nilai bisa ditimpa sementara tanpa
mengubah berkas:

    VPS_HOST=10.0.0.2 python deploy_vps.py --check
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env_file(path: str) -> dict[str, str]:
    """Baca pasangan KEY=VALUE dari berkas .env (tanpa dependensi tambahan)."""
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
    """Ambil satu nilai konfigurasi (environment dulu, lalu .env)."""
    return ENV.get(key) or default


def vps_config() -> dict[str, object]:
    """Kredensial + tujuan deploy. Berhenti dengan pesan jelas bila kurang.

    Tidak pernah mencetak nilai kredensial — hanya nama kunci yang kosong.
    """
    missing = [key for key in REQUIRED if not cfg(key)]
    if missing:
        print('\u274c Kredensial VPS belum lengkap: ' + ', '.join(missing))
        print('   Isi kunci ini di .env (berkas itu di-ignore git), lalu jalankan lagi:')
        print('     VPS_HOST=...  VPS_PORT=22  VPS_USER=...  VPS_PASSWORD=...')
        print('   Daftar lengkapnya ada di .env.example.')
        sys.exit(1)

    try:
        port = int(cfg('VPS_PORT', '22'))
    except ValueError:
        print('\u274c VPS_PORT harus angka, bukan: ' + repr(cfg('VPS_PORT')))
        sys.exit(1)

    return {
        'host': cfg('VPS_HOST'),
        'port': port,
        'user': cfg('VPS_USER'),
        'password': cfg('VPS_PASSWORD'),
        'remote_dir': cfg('VPS_REMOTE_DIR', '/opt/arkxmotion-studio'),
        # Default = folder tempat modul ini berada, jadi tidak ada path mesin
        # yang tertanam di skrip.
        'local_dir': cfg('ARKXMOTION_LOCAL_DIR', ROOT),
    }
