import { QrCode, RefreshCw } from 'lucide-react'

/**
 * Panel bayar BasuniPay — gambar QR dinamis dengan nominal TEPAT + kode unik.
 * Satu-satunya tampilan QRIS di aplikasi ini: QRIS statis lama tidak pernah
 * dirender (lihat tes test/noStaticQris.test.ts sebagai segelnya).
 */
export function BasunipayCheckoutButton({ url, payable, image }: { url?: string | null; payable?: number | null; image?: string | null }) {
  if (!url && !image) return null
  const nominal = payable ? Math.round(payable).toLocaleString('id-ID') : null
  return (
    <div className="mb-4 overflow-hidden rounded-xl border-2 border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_24px_-6px_rgba(16,185,129,0.45)]">
      <div className="bg-emerald-500/15 px-4 pt-3 pb-2 text-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Bayar tepat segini — jangan dibulatkan</div>
        {nominal && (
          <div className="mt-0.5 text-3xl font-black leading-none text-emerald-300">Rp {nominal}</div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">Pembayaran terverifikasi otomatis — saldo masuk sendiri</div>
      </div>
      {image && (
        <div className="flex justify-center border-y border-emerald-500/20 bg-white p-3">
          <img src={image} alt="QRIS dinamis BasuniPay" className="w-52 h-auto rounded" />
        </div>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-4 py-2 text-center text-[11px] font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          {image ? 'Link pembayaran cadangan (buka checkout BasuniPay)' : 'Gambar QR sedang diproses — buka checkout BasuniPay untuk QR'}
        </a>
      )}
    </div>
  )
}

/**
 * Panel "QRIS BasuniPay belum siap" — dipakai saat checkout belum bisa
 * ditampilkan (request gagal / server BasuNiPay sedang bermasalah).
 *
 * Sengaja TIDAK menampilkan QRIS statis: pembayaran harus selalu lewat QR
 * dinamis BasuniPay supaya nominalnya unik dan verifikasinya otomatis.
 * Kalau tetap menampilkan QRIS lama, nominalnya tidak terikat ke pengajuan
 * ini dan saldo tidak akan masuk sendiri.
 */
export function QrisPanel({
  amountLabel,
  exactAmount,
  onRetry,
  retrying,
}: {
  amountLabel?: string
  exactAmount?: number
  /** Siapkan ulang checkout BasuniPay untuk pengajuan ini (tanpa baris baru). */
  onRetry?: () => void
  retrying?: boolean
}) {
  const nominal = exactAmount && exactAmount > 0 ? Math.round(exactAmount) : null
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-center">
      <QrCode className="mx-auto mb-2 h-10 w-10 text-amber-400" />
      <div className="text-sm font-semibold text-amber-400">QRIS BasuniPay belum siap</div>
      <p className="mt-1 text-xs text-muted-foreground">
        QR dinamis sedang disiapkan. Semua pembayaran hanya lewat QRIS BasuniPay — nominal terikat ke
        pengajuan kamu sehingga verifikasinya otomatis.
      </p>
      {nominal ? (
        <div className="mt-2 text-sm text-muted-foreground">
          Siap bayar: <b className="text-amber-400">TEPAT Rp {nominal.toLocaleString('id-ID')}</b>
        </div>
      ) : amountLabel ? (
        <div className="mt-2 text-sm text-muted-foreground">
          Siap bayar: <b className="text-foreground">{amountLabel}</b>
        </div>
      ) : null}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-4 py-2 text-xs font-semibold text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Menyiapkan QRIS…' : 'Coba lagi siapkan QRIS'}
        </button>
      )}
    </div>
  )
}
