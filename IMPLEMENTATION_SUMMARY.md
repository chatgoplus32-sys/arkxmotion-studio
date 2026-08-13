# Implementasi Fitur AACS ke Arkxmotion Studio

## Tanggal: 2026-08-13

## Fitur yang Ditambahkan

### 1. Motion Control Credit Tracking System

**File Modified:** `src/lib/roboneo.ts`

Ditambahkan fungsi untuk tracking minimum credits yang diperlukan untuk Motion Control:

```typescript
const ROBONEO_MOTION_MIN_CREDITS_KEY = 'arkxmotion.roboneo.motionMinCredits'
const DEFAULT_MOTION_MIN_CREDITS = 151

export function getRoboneoMotionMinCredits(): number
export function noteRoboneoMotionChargeFailure(creditBalance: number | null): number
```

**Cara Kerja:**
- `getRoboneoMotionMinCredits()`: Membaca minimum credits dari localStorage (default: 151)
- `noteRoboneoMotionChargeFailure()`: Mencatat failure dan auto-update threshold jika balance lebih tinggi
- Threshold otomatis naik jika terjadi CHARGE_FAILED dengan balance tertentu

**File Modified:** `src/pages/Motion.tsx`

Integrasi tracking di error handler:

```typescript
if (isRoboneo && isRoboneoBalanceError(err.message)) {
  const newMin = noteRoboneoMotionChargeFailure(activeKey.balance)
  addLog(`⚠️ Motion min credits updated to ${newMin}`)
}
```

---

### 2. Safety Error Detection yang Lebih Baik

**File Modified:** `src/lib/roboneo.ts`

Ditambahkan fungsi detection yang lebih komprehensif:

```typescript
export function isRoboneoSafetyError(msg: string): boolean
export function isRoboneoCredentialError(msg: string): boolean
export function isRoboneoBalanceError(msg: string): boolean
export function isRoboneoRotatableError(msg: string): boolean
```

**Pattern Detection:**
- **Safety Error**: `safety review`, `risk control`, `content review`, `moderation`, `审核不通过`, `error_code 10025`
- **Credential Error**: `token error`, `invalid token`, `auth failed`, `please log in`, `401`, `403`
- **Balance Error**: `insufficient`, `credit habis`, `CHARGE_FAILED`, `余额不足`, `积分不足`
- **Rotatable Error**: Kombinasi credential + balance errors (untuk auto-rotate token)

**File Modified:** `src/lib/tokenRotation.ts`

Updated detection:

```typescript
export function isRoboneoTokenError(error: any): boolean {
  return isRoboneoRotatableError(msg)
}
```

---

### 3. Auto-Sync Token Mechanism

**File Modified:** `src/lib/roboneo.ts`

Ditambahkan fungsi sync cross-tab/window:

```typescript
const ROBONEO_SYNC_STORAGE_KEY = 'arkxmotion.roboneo.keys'

export function syncRoboneoTokensToStorage(tokens: Array<{...}>): void
export function removeRoboneoKeyFromManager(accessToken: string, reason?: string): { removed: boolean; remaining: number }
export function updateRoboneoKeyBalance(accessToken: string, balance: number | null): void
```

**Cara Kerja:**
- `syncRoboneoTokensToStorage()`: Sync token array ke localStorage
- `removeRoboneoKeyFromManager()`: Hapus token invalid + dispatch event
- `updateRoboneoKeyBalance()`: Update balance + status token
- Dispatch `CustomEvent('aatools:tokens-synced')` untuk sync antar tab/window
- Dispatch `Event('storage')` untuk trigger localStorage listeners

**Event Detail:**
```typescript
{
  provider: 'roboneo',
  action: 'updated' | 'removed' | 'balance',
  reason?: string
}
```

---

## Perbedaan dengan AACS

### Sudah Sama ✅
- API endpoints (`/api/public/roboneo`, `/api/public/roboneo-membership`)
- Model I2V/T2V support (Seedance, Kling, Happy Horse, etc.)
- Token format (_v2...)
- Balance checking logic
- Error detection patterns

### Yang Ditambahkan (sekarang) ✅
1. Motion control credit tracking system
2. Safety error detection lebih baik
3. Auto-sync token mechanism dengan CustomEvent

### Yang Belum Ada (AACS Only) ⚠️
1. **Image Edit Models**: Nano Banana Pro/2 (`submitRoboneoImageEdit`)
2. **getAllRoboneoKeys()**: Helper untuk ambil semua keys dari storage
3. **runRoboneoT2V()**: Wrapper untuk T2V dengan auto token rotation

---

## Testing Checklist

- [ ] Test Motion Control dengan balance mendekati threshold
- [ ] Test CHARGE_FAILED → verify threshold auto-update
- [ ] Test safety error detection (prompt with moderation issues)
- [ ] Test credential error → auto token rotation
- [ ] Test balance update sync antar tab
- [ ] Test token removal sync antar tab
- [ ] Verify localStorage keys sama: `arkxmotion.roboneo.keys`

---

## Migration Notes

Tidak ada breaking changes. Semua fungsi baru adalah **additive**:
- Existing code tetap berfungsi
- New functions opsional (akan fallback ke behavior lama jika tidak digunakan)
- Storage key compatible dengan sistem existing

---

## Next Steps (Optional)

Jika ingin 100% parity dengan AACS:

1. **Image Edit Models**: Implement `submitRoboneoImageEdit()` untuk Nano Banana Pro/2
2. **Unified Key Manager**: Implement `getAllRoboneoKeys()` + `ROBONEO_CLIENT_ID` constant
3. **T2V Wrapper**: Implement `runRoboneoT2V()` dengan auto-rotation built-in
4. **Storage Event Listener**: Setup global listener untuk sync dari tab lain:
   ```typescript
   window.addEventListener('storage', (e) => {
     if (e.key === 'arkxmotion.roboneo.keys') {
       // reload keys dari storage
     }
   })
   ```
