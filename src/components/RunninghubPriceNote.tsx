// Catatan biaya RunningHub untuk diletakkan di atas tombol Generate.
// Harga efektif diambil dari System Settings (admin) — bukan hardcode.
import { useRunninghubPricing, rhModelPrice } from '@/lib/runninghubPricing'
import { formatRp } from '@/lib/payment'

export default function RunninghubPriceNote({
  action,
  className = '',
}: {
  /** Action charge server, mis. 'submit-h3-music-avatar'. Lihat RUNNINGHUB_MODEL_PRICES. */
  action: string
  className?: string
}) {
  const pricing = useRunninghubPricing()
  return (
    <div className={`flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground ${className}`}>
      Biaya:{' '}
      <b className="text-foreground font-mono">{formatRp(rhModelPrice(pricing, action))}</b>
      <span>/ generate</span>
    </div>
  )
}
