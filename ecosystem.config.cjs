// Environment proses produksi — sumber kebenaran untuk NODE_ENV dan PORT.
//
// Deploy menerapkannya dengan `pm2 startOrReload ecosystem.config.cjs`.
// Restart lewat nama proses (tanpa berkas ini) tidak membacanya, jadi NODE_ENV
// tidak pernah sampai ke proses: isProd=false, backup otomatis dilewati, dan
// gerbang 3 gagal di tiga deploy berturut-turut pada 17 Sep 2026.
// Dijaga oleh scripts/check-prod-env.sh (gerbang 3a) dan test/prodEnvGate.test.ts.
module.exports = {
  apps: [
    {
      name: 'arkxmotion',
      script: 'tsx',
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
