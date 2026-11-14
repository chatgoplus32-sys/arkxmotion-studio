import { QrCode } from 'lucide-react'
import { QRIS_IMG, QRIS_MERCHANT, QRIS_NMID } from '@/lib/payment'

/** Toggle metode pembayaran DANA / QRIS (dipakai halaman top up). */
export function PaymentMethodToggle({
  value,
  onChange,
}: {
  value: 'dana' | 'qris'
  onChange: (v: 'dana' | 'qris') => void
}) {
  return (
    <div className="flex gap-2 mb-4">
      <button
        onClick={() => onChange('dana')}
        className={`flex-1 p-2.5 rounded-lg border text-sm font-medium transition ${
          value === 'dana'
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-accent/30'
        }`}
      >
        💜 Dana
      </button>
      <button
        onClick={() => onChange('qris')}
        className={`flex-1 p-2.5 rounded-lg border text-sm font-medium transition ${
          value === 'qris'
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-accent/30'
        }`}
      >
        <QrCode className="h-4 w-4 inline mr-1" />
        QRIS
      </button>
    </div>
  )
}

/** Panel bayar BasuniPay — gambar QR dinamis dengan nominal TEPAT + kode unik. */
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
          Link pembayaran cadangan (buka checkout BasuniPay)
        </a>
      )}
    </div>
  )
}

/** Panel tampilan QRIS (gambar statis + identitas merchant + nominal). */
export function QrisPanel({ amountLabel, exactAmount }: { amountLabel?: string; exactAmount?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 mb-4">
      <div className="text-sm font-medium mb-3">Scan QRIS untuk Bayar</div>
      <div className="flex justify-center mb-3">
        <img
          src={QRIS_IMG}
          alt={`QRIS ${QRIS_MERCHANT}`}
          className="w-64 h-auto rounded-lg border border-border"
          onError={(e) => {
            const target = e.target as HTMLImageElement
            target.style.display = 'none'
            const fallback = target.nextElementSibling as HTMLElement
            if (fallback) fallback.style.display = 'flex'
          }}
        />
        <div className="hidden flex-col items-center justify-center w-64 h-64 rounded-lg border border-dashed border-border text-center p-4">
          <QrCode className="h-12 w-12 text-muted-foreground mb-2" />
          <div className="text-xs text-muted-foreground">
            QRIS image belum tersedia.
            <br />Simpan ke <code className="text-primary">public/qris-arkx.jpg</code>
          </div>
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground space-y-1">
        <div className="font-semibold text-foreground">{QRIS_MERCHANT}</div>
        <div className="text-xs">NMID: {QRIS_NMID}</div>
        <div className="text-xs">Scan menggunakan aplikasi bank/e-wallet Anda</div>
        {exactAmount !== undefined && exactAmount > 0 ? (
          <div className="text-xs">
            Bayar <span className="font-bold text-amber-400">TEPAT Rp {Math.round(exactAmount).toLocaleString('id-ID')}</span>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Nominal ini sudah termasuk kode unik — jangan dibulatkan, kalau tidak verifikasi otomatisnya tidak cocok.
            </div>
          </div>
        ) : (
          amountLabel && (
            <div className="text-xs">
              Bayar sesuai nominal:{' '}
              <span className="font-semibold text-foreground">{amountLabel}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}
