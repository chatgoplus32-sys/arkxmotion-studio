// Environment proses produksi — sumber kebenaran untuk NODE_ENV dan PORT.
//
// Deploy menyalakannya lewat jalur "start": pm2 delete arkxmotion, lalu
// pm2 start ecosystem.config.cjs. Restart lewat nama proses tidak membaca
// environment di sini (NODE_ENV tidak pernah sampai ke proses: isProd=false,
// backup otomatis dilewati, gerbang 3 merah tiga deploy berturut-turut).
//
// `script` WAJIB path absolut. pm2 me-resolve script relatif hanya di jalur
// start, dan itu dikerjakan di sisi CLI; jalur restart/reload dari berkas
// mengirim konfigurasi mentah ke daemon, yang mengulang
// path.resolve(cwd, 'tsx') → /opt/arkxmotion-studio/tsx tidak ada, tsx tidak
// ada di PATH → "Script not found" dan proses tidak pernah dinyalakan
// (17 Sep 2026: seluruh /api produksi 502).
//
// Dijaga oleh scripts/check-prod-env.sh (gerbang 3a) dan test/prodEnvGate.test.ts.
const path = require('path')

module.exports = {
  apps: [
    {
      name: 'arkxmotion',
      script: path.join(__dirname, 'node_modules', '.bin', 'tsx'),
      args: 'server/index.ts',
      cwd: __dirname,
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 6000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
