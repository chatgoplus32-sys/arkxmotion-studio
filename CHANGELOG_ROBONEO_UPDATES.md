# Roboneo Provider Updates - 2026-08-13

## 🎯 Tujuan
Menyamakan implementasi Roboneo provider di Arkxmotion Studio dengan AACS (https://aacs.web.id/manage/tokens)

---

## ✅ Fitur yang Ditambahkan

### 1. Motion Control Credit Tracking System

**File Modified:**
- `src/lib/roboneo.ts`
- `src/pages/Motion.tsx`

**Fungsi Baru:**
```typescript
getRoboneoMotionMinCredits(): number
noteRoboneoMotionChargeFailure(creditBalance: number | null): number
```

**Fitur:**
- Tracking minimum credits yang diperlukan untuk Motion Control (default: 151)
- Auto-update threshold jika CHARGE_FAILED dengan balance tertentu
- Persistensi ke localStorage: `arkxmotion.roboneo.motionMinCredits`
- Integrasi di Motion.tsx error handler untuk mencatat failure dan update threshold

**Use Case:**
Saat motion control gagal karena balance tidak cukup, sistem otomatis update minimum credits requirement agar tidak mencoba lagi dengan balance yang sama.

---

### 2. Improved Safety Error Detection

**File Modified:**
- `src/lib/roboneo.ts`
- `src/lib/tokenRotation.ts`

**Fungsi Baru:**
```typescript
isRoboneoSafetyError(msg: string): boolean
isRoboneoCredentialError(msg: string): boolean
isRoboneoBalanceError(msg: string): boolean
isRoboneoRotatableError(msg: string): boolean
```

**Pattern Detection:**

| Type | Patterns |
|------|----------|
| Safety Error | `safety review`, `risk control`, `content review`, `moderation`, `审核不通过`, `error_code 10025` |
| Credential Error | `token error`, `invalid token`, `auth failed`, `please log in`, `401`, `403` |
| Balance Error | `insufficient`, `credit habis`, `CHARGE_FAILED`, `余额不足`, `积分不足` |
| Rotatable Error | Credential + Balance errors (untuk auto token rotation) |

**Improvements:**
- Safety error dipisahkan dari credential/balance error (tidak trigger token rotation)
- Token rotation hanya untuk credential/balance issues
- Lebih akurat dalam mendeteksi penyebab error

---

### 3. Auto-Sync Token Mechanism

**File Modified:**
- `src/lib/roboneo.ts`

**Fungsi Baru:**
```typescript
syncRoboneoTokensToStorage(tokens: Array<{...}>): void
removeRoboneoKeyFromManager(accessToken: string, reason?: string): { removed: boolean; remaining: number }
updateRoboneoKeyBalance(accessToken: string, balance: number | null): void
```

**Storage Key:**
```typescript
const ROBONEO_SYNC_STORAGE_KEY = 'arkxmotion.roboneo.keys'
```

**Custom Events:**
```typescript
// Event dispatch untuk sync antar tab/window
window.dispatchEvent(new CustomEvent('aatools:tokens-synced', {
  detail: { 
    provider: 'roboneo', 
    action: 'updated' | 'removed' | 'balance',
    reason?: string 
  }
}))

// Storage event untuk cross-tab sync
window.dispatchEvent(new Event('storage'))
```

**Fitur:**
- Sync token updates across tabs/windows
- Remove invalid tokens dengan reason tracking
- Update balance dengan auto status update ('active' | 'empty')
- Event-driven architecture untuk real-time sync

---

## 🔧 Bug Fixes

### server/db.ts - Syntax Error
**File Modified:** `server/db.ts:157`

**Before:**
```typescript
db.prepare('INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (?, 0, '')').run(p)
```

**After:**
```typescript
db.prepare('INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (?, 0, \'\')').run(p)
```

**Issue:** Empty string literal tidak di-escape dengan benar dalam SQL string
**Fix:** Escape single quotes dengan backslash

---

## 📊 Comparison: Arkxmotion vs AACS

| Feature | AACS | Arkxmotion (Before) | Arkxmotion (After) |
|---------|------|--------------------|--------------------|
| Motion Credit Tracking | ✅ | ❌ | ✅ |
| Safety Error Detection | ✅ | Partial | ✅ |
| Auto-Sync Tokens | ✅ | ❌ | ✅ |
| Balance Error Detection | ✅ | ✅ | ✅ (Improved) |
| Credential Error Detection | ✅ | ✅ | ✅ (Improved) |
| Image Edit Models (Nano Banana) | ✅ | ❌ | ❌ (Future) |
| Token Rotation | ✅ | ✅ | ✅ |
| I2V/T2V Models | ✅ | ✅ | ✅ |

---

## 🧪 Testing Checklist

- [ ] Test Motion Control dengan balance mendekati threshold
- [ ] Test CHARGE_FAILED → verify threshold auto-update di localStorage
- [ ] Test safety error detection (prompt with moderation issues)
- [ ] Test credential error → verify auto token rotation
- [ ] Test balance error → verify auto token rotation
- [ ] Test balance update sync antar tab (buka 2 tab, update balance di satu tab)
- [ ] Test token removal sync antar tab
- [ ] Verify localStorage key: `arkxmotion.roboneo.keys`
- [ ] Verify localStorage key: `arkxmotion.roboneo.motionMinCredits`
- [ ] Test CustomEvent dispatch: `aatools:tokens-synced`

---

## 📝 Technical Details

### Storage Keys
```typescript
'arkxmotion.roboneo.keys'              // Token storage (sync with providerManager)
'arkxmotion.roboneo.motionMinCredits'  // Motion control min credits threshold
```

### Event System
```typescript
// Token sync event
CustomEvent('aatools:tokens-synced', {
  provider: 'roboneo',
  action: 'updated' | 'removed' | 'balance',
  reason?: string
})

// Storage change event (untuk cross-tab sync)
Event('storage')
```

### Error Detection Flow
```
Error Message
    ↓
isRoboneoSafetyError? → Yes → Don't rotate, show moderation message
    ↓ No
isRoboneoCredentialError? → Yes → Rotate to next token
    ↓ No
isRoboneoBalanceError? → Yes → Rotate + update min credits (if Motion)
    ↓ No
Generic error → Propagate to user
```

---

## 🚀 Performance Impact

- **Storage Operations:** Minimal (localStorage writes only on token changes)
- **Event Dispatch:** Negligible (event listeners are passive)
- **Balance Check:** Already implemented, no additional overhead
- **Credit Tracking:** Single localStorage read/write per failed generation

**Estimated Overhead:** < 1ms per operation

---

## 🔮 Future Enhancements (Optional)

1. **Image Edit Models** (Nano Banana Pro/2)
   - Implement `submitRoboneoImageEdit()` function
   - Add to model selection UI

2. **Unified Key Manager**
   - Implement `getAllRoboneoKeys()` helper
   - Add `ROBONEO_CLIENT_ID` constant

3. **T2V Wrapper with Auto-Rotation**
   - Implement `runRoboneoT2V()` dengan built-in token rotation
   - Similar to AACS implementation

4. **Global Storage Listener**
   - Setup global listener untuk sync dari tab lain:
   ```typescript
   window.addEventListener('storage', (e) => {
     if (e.key === 'arkxmotion.roboneo.keys') {
       useProviderManager.getState().loadFromStorage()
     }
   })
   ```

---

## 📚 References

- **AACS Implementation:** https://aacs.web.id/manage/tokens
- **Roboneo Module (AACS):** `/assets/roboneo-Cac5c9IV.js`
- **Provider Manager:** `src/stores/providerManager.ts`
- **Token Rotation:** `src/lib/tokenRotation.ts`

---

## ✅ Verification

**Lint Status:** ✅ Passed (181 warnings, 0 errors)

```bash
npm run lint
# Found 181 warnings and 0 errors.
```

**Modified Files:**
1. `src/lib/roboneo.ts` - Added 3 new functions
2. `src/lib/tokenRotation.ts` - Updated imports & detection
3. `src/pages/Motion.tsx` - Integrated credit tracking
4. `server/db.ts` - Fixed SQL syntax
5. `IMPLEMENTATION_SUMMARY.md` - Documentation
6. `CHANGELOG_ROBONEO_UPDATES.md` - This file

---

## 👥 Contributors

- Implementation: AI Assistant (Kiro)
- Date: 2026-08-13
- Review Status: Pending

---

## 📄 License

Same as Arkxmotion Studio project license.
