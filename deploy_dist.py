"""Deploy cepat: build -> tar dist/ -> unggah -> dist/ lama DIHAPUS -> ekstrak -> restart pm2.

Kenapa menghapus dulu: ekstrak tar di atas dist/ lama meninggalkan chunk hasil
build terdahulu (mis. `Providers-o_0yFupD.js`) yang tidak dirujuk index.html
baru. Folder yang menumpuk membuat `dist/` membingungkan saat debug dan makan
ruang disk VPS.

Pemakaian:
    python deploy_dist.py              # build lalu deploy
    python deploy_dist.py --no-build   # pakai dist/ yang sudah ada
    python deploy_dist.py --check      # hanya cek kredensial, tanpa unggah
"""
import os
import subprocess
import sys
import tarfile
import time

import paramiko

from deploy_config import cfg, vps_config

ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIST = os.path.join(ROOT, 'dist')
TAR_PATH = os.path.join(ROOT, '.tmpdbg', 'dist.tar.gz')
REMOTE_TAR = '/tmp/arkxmotion_dist_upload.tar.gz'


def run(cmd: str) -> None:
    print('+', cmd)
    # shell=True: di Windows npm adalah npm.cmd dan butuh PATH shell.
    subprocess.run(cmd, cwd=ROOT, check=True, shell=True)


def build() -> None:
    run('npm run build')
    if not os.path.isdir(LOCAL_DIST):
        print('[X] Folder dist/ tidak ada setelah build.')
        sys.exit(1)


def make_tar() -> int:
    os.makedirs(os.path.dirname(TAR_PATH), exist_ok=True)
    with tarfile.open(TAR_PATH, 'w:gz') as tar:
        tar.add(LOCAL_DIST, arcname='dist')
    return os.path.getsize(TAR_PATH)


def deploy() -> None:
    conf = vps_config()
    remote_dir = str(conf.get('remote_dir') or '/opt/arkxmotion-studio')

    size = make_tar()
    print('arsip dist: %.1f MB' % (size / 1024 / 1024))

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        conf['host'], port=conf['port'], username=conf['user'], password=conf['password'],
        timeout=60, allow_agent=False, look_for_keys=False, banner_timeout=60,
    )
    try:
        sftp = client.open_sftp()
        sftp.put(TAR_PATH, REMOTE_TAR)
        sftp.close()

        # rm -rf dist: buang total isi build lama, jadi tidak ada chunk basi.
        perintah = (
            'cd %s && rm -rf dist && tar -xzf %s && rm -f %s && '
            'echo "jumlah file di dist/assets:" && ls dist/assets | wc -l'
            % (remote_dir, REMOTE_TAR, REMOTE_TAR)
        )
        _in, out, err = client.exec_command(perintah, timeout=180)
        print(out.read().decode('utf-8', 'replace').strip())
        pesan_err = err.read().decode('utf-8', 'replace').strip()
        if pesan_err:
            print('stderr:', pesan_err[:300])

        client.exec_command('cd %s && pm2 restart arkxmotion --update-env' % remote_dir, timeout=180)
        print('menunggu server siap...')
        for _ in range(30):
            time.sleep(2)
            _in, out, _err = client.exec_command(
                "curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:6000/api/health", timeout=20,
            )
            if out.read().decode('utf-8', 'replace').strip() == '200':
                print('OK /api/health 200 - deploy selesai.')
                break
        else:
            print('[X] Server tidak membalas 200 setelah 60 detik. Cek: pm2 logs arkxmotion')
            sys.exit(1)
    finally:
        client.close()


def main() -> None:
    args = sys.argv[1:]
    if '--check' in args:
        vps_config()
        print('OK kredensial VPS lengkap. Mode --check: tidak ada yang diunggah.')
        return
    if '--no-build' not in args:
        build()
    deploy()
    print('halaman: http://' + str(cfg('VPS_HOST')) + '/')


if __name__ == '__main__':
    main()
