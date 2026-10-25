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

/** Panel tampilan QRIS (gambar statis + identitas merchant + nominal). */
export function QrisPanel({ amountLabel }: { amountLabel?: string }) {
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
        {amountLabel && (
          <div className="text-xs">
            Bayar sesuai nominal:{' '}
            <span className="font-semibold text-foreground">{amountLabel}</span>
          </div>
        )}
      </div>
    </div>
  )
}
