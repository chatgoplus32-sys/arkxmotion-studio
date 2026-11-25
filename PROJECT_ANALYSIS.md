# arkxmotion-studio Project Analysis & Backup

## 📋 Summary for Lovable.ai Continuation

Project: ARK X Motion Studio - AI-Powered Creative Content Platform
Location: /d/clone/arkxmotion-studio

## 🔧 Core Architecture

### 1. Routing System (React Router v7)
**Main entry:** `src/App.tsx:19-50`

Route Table:
```
/                    → DashboardPage                    
/command              → CommandPage                      
/generate/motion       → MotionPage                       
/generate/naratif     → NaratifPage                      
/generate/storyboard  → StoryboardPage                    
/generate/bulk-fashion → BulkFashionPage                   
/generate/image-to-video → ImageToVideoPage               
/research             → ResearchPage                     
/projects             → ProjectsPage                     
/assets               → AssetsPage                       
/providers            → ProvidersPage  ⭐ (This page)      
/settings             → SettingsPage
```

Sidebar Navigation Groups:
- **Main:** Dashboard, Command Center
- **Generate:** Motion Control, Naratif Video, Storyboard, Bulk Fashion, Image to Video
- **Tools:** Research, Projects, Assets, Providers, Settings

### 2. Providers Page Component
**File:** `src/pages/Providers.tsx:31-332` (333 lines total)

#### Key Features:
- **7 AI Providers Supported:**
  - Wavespeed, Magnific, Roboneo (Video/AI)
  - CreatePulse (Video creation) 
  - Gemini, OpenAI (Voice/Text)

- **API Key Management:**
  - Add/Edit/Delete keys with validation
  - Status tracking (Active/Expired/Invalid/Empty/Unknown)
  - Balance display for supported providers
  - Show/Hide key visibility toggle

- **Provider Status:**
  - Global stats dashboard (Total/Active Keys)
  - Provider readiness badges
  - Auto-detect best available provider

- **Workflow Routing (5 workflows):**
  - Motion Control
  - Naratif Video
  - Storyboard
  - Bulk Fashion
  - Image to Video
  - All configurable via dropdowns

- **Quick Actions:**
  - Auto-detect first valid provider
  - Reset all settings (clears localStorage)

#### Dependencies:
- **State:** `zustand` provider store
- **Components:** Custom UI library (Button, Input, Card, Section, etc.)
- **Icons:** Lucide-react for all UI actions
- **Animations:** Tailwind CSS with custom animations

### 3. Provider Management Store
**File:** `src/stores/providerManager.ts:167-253` (253 lines)

#### Provider Types:
```typescript
type ProviderId = 'wavespeed' | 'magnific' | 'roboneo' | 
                 'createpulse' | 'gemini' | 'openai';
```

#### Data Structure:
```typescript
interface ProviderKey {
  id: string;
  key: string;
  name?: string;
  status: 'active' | 'expired' | 'invalid' | 'empty' | 'unknown';
  balance?: number | null;
  email?: string;
  lastChecked?: number;
}
```

#### Storage Keys:
- `arkxmotion.providers` - All API keys per provider
- `arkxmotion.routing` - Workflow-to-provider mappings
- `arkxmotion.activeProvider` - Currently active provider ID

#### Key Functions:
- `addKey(provider, key, name)` - Add new API key
- `removeKey(provider, keyId)` - Remove key
- `updateKeyStatus(provider, keyId, status, balance)` - Validate/update key
- `getActiveKey(provider)` - Get first active key
- `getFirstValidKey(provider)` - Get active or unknown key
- `setRouting(workflow, provider)` - Configure workflow routing

#### Default Values:
- **All providers:** Empty keys initially
### 4. UI Component Library
**Location:** `src/components/ui/`

#### Key UI Components:
- **Section:** Card with title, subtitle, action buttons
- **Button:** 5 variants × 4 sizes, loading states
- **Input:** Styled text inputs with validation
- **Badge:** Status indicators (Success/Warning/Destructive/Outline)
- **Select:** Custom dropdowns
- **Card:** Content containers

### 5. Layout Components
**Location:** `src/components/layout/`

#### Components:
- **Sidebar:** Collapsible navigation with route links
- **Header:** Sticky header with sidebar toggle
- **PageHeader:** Page title/description/layout
- **PageContent:** Content wrapper

### 6. Build Configuration
**File:** `package.json:1-11`

#### Scripts:
```bash
npm run dev       # Vite dev server (port 5173)
npm run build     # Production build
npm run test      # Test (node:test via tsx — lihat folder test/)
npm run typecheck # tsc untuk app + test
npm run lint      # OXLint linting
```

#### Dependencies:
```
"dependencies": {
  "react": "^19.2.7",
  "react-dom": "^19.2.7",
  "react-router-dom": "^7.18.1",
  "zustand": "^5.0.14",
  "lucide-react": "^1.26.0"
}
```

## 📁 Project Structure

```
/src/
├── App.tsx                           # Router & layout
├── main.tsx                          # React entry
├── index.css                         # Tailwind CSS
├── assets/                           # Static assets
├── components/                       # UI components
│   ├── layout/                       # Layout components
│   │   ├── Header.tsx                # Header bar
│   │   ├── PageHeader.tsx            # Page title
│   │   ├── PageContent.tsx           # Content wrapper
│   │   └── Sidebar.tsx               # Navigation sidebar
│   └── ui/                           # UI components
│       ├── Button.tsx                # Button components
│       ├── Card.tsx                  # Card components
│       ├── Input.tsx                 # Input components
│       ├── Section.tsx               # Section components
│       ├── Select.tsx                # Select components
│       ├── Badge.tsx                 # Badge components
│       └── ... other components
├── stores/                           # Zustand stores
│   ├── appStore.ts                   # App state
│   ├── providerManager.ts            # Provider manager ⭐
│   ├── index.ts                      # Store exports
│   └── ... other stores
├── pages/                           # Route pages
│   ├── Providers.tsx                # Providers page ⭐
│   ├── Dashboard.tsx                # Dashboard
│   ├── ImageToVideo.tsx             # Image-to-video generator
│   └── ... other pages
└── ... other files
```

## 🔍 Key Implementation Details

### Providers Page TypeScript Types:
```typescript
const PROVIDER_IDS: ProviderId[] = [
  'wavespeed', 'magnific', 'roboneo',
  'createpulse', 'gemini', 'openai'
];

const WORKFLOW_ROUTES = [
  { id: 'motion', label: 'Motion Control' },
  { id: 'narrative-video', label: 'Naratif Video' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'bulk-fashion', label: 'Bulk Fashion' },
  { id: 'image-to-video', label: 'Image to Video' },
];
```

### Provider Configuration:
**PROVIDER_CONFIGS:** Complete provider metadata
- Icons, names, descriptions
- Key placeholders and formats
- Credit requirements and balance support

### Validation Logic:
- **API Key Validation:** 1500ms simulated timeout
- **Status Transitions:** Unknown → Active/Expired/Invalid
- **Balance Updates:** Random balance on validation

### Workflow Routing:
- **Runtime configuration** via dropdowns
- **Live updates** when settings change

## 🛠 Technical Specifications

### Framework Stack:
- **Framework:** React 19 + TypeScript
- **Build Tool:** Vite 8 with Tailwind CSS 4
- **Routing:** React Router DOM v7 (client-side)
- **State Management:** Zustand v5 (flux-like)
- **Icons:** Lucide React
- **Linting:** OXLint

### Build Output:
- **Client:** `dist/` directory
- **JS Bundle:** `dist/assets/index-Cc54FMI5.js` (368KB)
- **CSS Bundle:** `dist/assets/index-BSdNJeAP.css` (38KB)
- **HTML:** `dist/index.html`

### Local Storage Keys:
- `arkxmotion.providers` - JSON string
- `arkxmotion.routing` - JSON string
- `arkxmotion.activeProvider` - String

### Key Features:
✅ **No external API calls** in providers management
✅ **Real API only in ImageToVideo page** (CreatePulse integration)
✅ **All other providers simulated** with timeouts
✅ **Responsive design** (mobile/tablet/desktop)
✅ **Accessibility** (ARIA labels, keyboard navigation)
✅ **Component testing** (TypeScript strict mode)
✅ **Linting** (Code quality checks)

## 🚀 Next Development Steps

### Menjalankan lokal:
1. `cp .env.example .env` lalu isi minimal `JWT_SECRET` (lihat `.env.example` untuk panduan)
2. `npm install`
3. `npm run dev:all` — frontend (port 5173) + server (port 6000) bersamaan
4. Uji berkala: `npm test` · `npm run typecheck` · `npm run lint`

### Workflow deploy:
1. Push ke branch `main` → GitHub Actions (`.github/workflows/deploy-vps.yml`) otomatis deploy ke VPS
2. Gerbang yang harus hijau: test suite, smoke test (server harus boot), build frontend, mode production + snapshot backup
3. Gagal di salah satu gerbang = deploy dibatalkan, versi lama tetap melayani

### Sumber kebenaran setup:
- `README.md` (struktur, perintah, deploy) dan `.env.example` (semua variabel environment)
- Dokumen pendukung: `SMTP_SETUP.md`, `R2_BACKUP_SETUP.md`, `BOOT_BACKUP_GATE.md`, `NEXABOT_MASTER_KEY.md`, `ADDON_AKUN.md`

> Catatan: dokumen ini adalah analisis awal proyek. Tooling lama yang disebut di
> bawah (Lovable.ai) sudah tidak dipakai — ikuti README untuk pekerjaan baru.

## 📊 Current Status

✅ **Complete Code Analysis:** 100%
✅ **Architecture Documented:** Yes  
✅ **Implementation Verified:** Yes  
✅ **Tests Written:** Ya — folder `test/` (node:test lewat tsx, `npm run test`)
✅ **Build Working:** Yes
✅ **TypeScript:** No errors
✅ **Linting:** Working

## 🎯 Lanjutan pengembangan

1. Baca `README.md` untuk setup dan struktur terkini
2. Ikuti pola halaman yang sudah ada di `src/pages/`
3. Jalankan `npm run lint` dan `npm test` sebelum push
4. Deploy otomatis lewat push ke `main` (lihat bagian Deploy frontend ke VPS)