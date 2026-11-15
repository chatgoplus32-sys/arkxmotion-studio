/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  downloadNexabotResult,
  pollNexabotJob,
  runWithNexabotThrottleRetry,
  saveNexabotResult,
  submitNexabot
} from '@/lib/nexabot';
import { chargeNexabotWallet, refundNexabotWallet } from '@/lib/nexabotWallet';
import { startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks';
import { runNexabotJobWithSessionFallback } from '@/pages/image-to-video/nexabotSessionFallback';
import { concatVideosFFmpeg } from '@/lib/ffmpeg-compress';
import { fetchVideoFile } from '@/lib/videoChunks';
import { useAuthStore } from '@/stores/authStore';
import { Lightbulb, FileText, Image as ImageIcon, Sparkles, Loader2, Check, Copy, X, ArrowRight, ArrowLeft, PlayCircle, List, Trash2, AlertCircle, Video, ScanSearch, Upload, ShoppingBag, Plus, Zap, ImagePlay, KeyRound, Lock } from 'lucide-react';

// ============================================================================
// KONFIGURASI TIPE SKEMA AI
// ============================================================================
const Type = {
  OBJECT: "OBJECT",
  ARRAY: "ARRAY",
  STRING: "STRING",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN"
};

// ============================================================================
// CUSTOM STYLES (INJECTED DIRECTLY)
// ============================================================================
const CustomStyles = () => (
  <style dangerouslySetInnerHTML={{ __html: `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Pacifico&display=swap');

    :root {
      --font-sans: 'Inter', sans-serif;
      --font-fancy: 'Pacifico', cursive;
    }

    /* Warna mengikuti token ARKXMotion Studio (src/index.css @theme). */
    body {
      font-family: var(--font-sans);
      background-color: #050510;
      color: #f5f5f5;
    }

    .font-fancy {
      font-family: var(--font-fancy);
    }

    /* Custom Scrollbar (Light Theme) */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #0c0c1a;
    }
    ::-webkit-scrollbar-thumb {
      background: #23233d;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #33334f;
    }

    /* Selection Color */
    ::selection {
      background: rgba(0, 168, 255, 0.25);
      color: #f5f5f5;
    }

    /* Custom Animations */
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    
    .anim-fade-in { animation: fadeIn 0.3s ease-out forwards; }
    .anim-fade-in-up { animation: fadeInUp 0.4s ease-out forwards; }
    .anim-zoom-in { animation: zoomIn 0.3s ease-out forwards; }

    html, body, #root { min-height: 100%; }
    body { margin: 0; }
    .app-frame {
      width: calc(100vw - 30px); max-width: 1680px; height: calc(100vh - 50px);
      margin: 50px auto 0; border-radius: 16px 16px 0 0; background: #0c0c1a;
      border: 1px solid #1a1a2e;
      box-shadow: 0 18px 48px rgba(0,0,0,.55); overflow: hidden;
    }
    .app-sidebar { width: 272px; flex: 0 0 272px; background: #0c0c1a; box-shadow: none; border-right: 1px solid #1a1a2e; }
    .app-brand { height: 80px; flex: 0 0 80px; padding: 0 26px; border-bottom: 1px solid #f1f2f4; gap: 14px; }
    .brand-globe {
      position: relative; width: 30px; height: 30px; flex: 0 0 30px; overflow: hidden; border-radius: 50%;
      border: 1px solid #d9e2eb; background: radial-gradient(circle at 34% 27%, #c5f4ff 0 12%, #56bde5 13% 27%, #2e79bb 28% 55%, #142f70 56% 100%);
      box-shadow: inset -3px -3px 7px rgba(8,30,74,.42), 0 1px 3px rgba(15,23,42,.12);
    }
    .brand-globe:before { content: ''; position: absolute; inset: 4px 7px; border: 1px solid rgba(255,255,255,.64); border-radius: 50%; }
    .brand-globe:after { content: ''; position: absolute; left: 3px; right: 3px; top: 14px; height: 1px; background: rgba(255,255,255,.68); box-shadow: 0 -5px 0 rgba(255,255,255,.25), 0 5px 0 rgba(255,255,255,.25); }
    .font-fancy { font-family: 'Pacifico', cursive; font-size: 23px; line-height: 1; letter-spacing: -.4px; color: #141722; font-weight: 400; }
    .app-nav { padding: 24px 14px; gap: 6px; }
    .app-nav button { min-height: 47px; padding: 0 15px; border-radius: 12px; font-size: 13px; line-height: 1.35; }
    .app-sidebar-footer { padding: 16px 18px 18px; border-top: 1px solid #1a1a2e; background: #0c0c1a; }
    .app-update-badge { margin: 0 auto 13px; width: max-content; }
    .profile-card { display: flex; align-items: center; gap: 11px; padding: 10px 11px; min-height: 58px; background: #101024; border: 1px solid #1a1a2e; border-radius: 12px; box-shadow: none; }
    .profile-avatar { width: 37px; height: 37px; border-radius: 50%; display: grid; place-items: center; color: #66d3ff; background: rgba(0,168,255,.12); border: 1px solid rgba(0,168,255,.35); font-size: 14px; font-weight: 700; }
    .profile-name { color: #252834; font-size: 12px; font-weight: 700; line-height: 1.25; }
    .profile-role { color: #7f8490; font-size: 10px; margin-top: 2px; letter-spacing: .04em; }
    .profile-settings { margin-left: auto; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: #818695; }
    .profile-settings:hover { background: rgba(255,255,255,.06); color: #66d3ff; }
    .app-main { background: #050510; }
    .app-content { width: 100%; max-width: none; margin: 0; padding: 0 22px 48px; box-sizing: border-box; }
    .app-desktop-topbar { height: 80px; padding: 0 0; margin: 0; align-items: center; }
    .app-desktop-topbar button { height: 38px; border-radius: 11px; padding: 0 15px; font-size: 13px; font-weight: 600; }
    .workspace-panel { border-color: #1a1a2e; border-radius: 17px; padding: 28px 30px; box-shadow: none; }
    .workspace-panel h2 { font-size: 22px; line-height: 1.3; margin-bottom: 7px; letter-spacing: -.015em; }
    .workspace-panel input, .workspace-panel select, .workspace-panel textarea { border-radius: 12px; }
    .workspace-panel input, .workspace-panel select { min-height: 51px; padding-top: 12px; padding-bottom: 12px; font-size: 14px; }
    .workspace-panel button:disabled { background: #16162e !important; color: #6f6f80 !important; box-shadow: none !important; }
    .app-mobile-header { background: rgba(12,12,26,.96); box-shadow: none; }
    @media (max-width: 767px) {
      body { background: #050510; }
      .app-frame { width: 100%; height: 100vh; height: 100dvh; margin: 0; border-radius: 0; box-shadow: none; }
      .app-mobile-header { min-height: 70px; }
      .app-main { padding: 0; }
      .app-content { padding: 0 16px 36px; }
      .app-desktop-topbar { display: none; }
      .workspace-panel { padding: 22px 18px; border-radius: 16px; }
      .workspace-panel h2 { font-size: 21px; }
    }

    /* ================================================================
       Tema gelap ARKXMotion Studio
       ----------------------------------------------------------------
       Halaman ini memakai utilitas Tailwind versi terang (bg-white,
       text-slate-900, dst). Supaya latar dan permukaannya sama dengan app
       induk tanpa menulis ulang 1.500 baris markup, utilitas itu dipetakan
       ke token warna app (background #050510, card #0c0c1a,
       border #1a1a2e, foreground #f5f5f5, primary #00a8ff).
       ================================================================ */
    .arkx-health { background: #050510; color: #f5f5f5; }

    /* Header memakai kelas sendiri: utilitas bg-white/95 (putih transparan) tidak
       ikut tertimpa aturan kelas biasa, jadi pitanya tetap terang. */
    /* Tab langkah digeser horizontal di layar sempit; scrollbar bawaan browser
       terlalu tebal dan memotong garis bawah header, jadi disembunyikan. */
    .arkx-tabs { scrollbar-width: none; -ms-overflow-style: none; }
    .arkx-tabs::-webkit-scrollbar { display: none; height: 0; }

    .arkx-header {
      background-color: rgba(10, 10, 22, 0.92) !important;
      border-bottom-color: #1a1a2e !important;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    .arkx-health .bg-white { background-color: #0c0c1a !important; }
    .arkx-health .bg-white\\/90 { background-color: rgba(12,12,26,.92) !important; }
    .arkx-health .bg-white\\/95 { background-color: rgba(12,12,26,.96) !important; }
    .arkx-health .bg-slate-50 { background-color: #050510 !important; }
    .arkx-health .bg-slate-100 { background-color: #12122a !important; }
    .arkx-health .bg-slate-200 { background-color: #16162e !important; }
    .arkx-health .bg-indigo-50 { background-color: rgba(0,168,255,.10) !important; }
    .arkx-health .bg-indigo-100 { background-color: rgba(0,168,255,.18) !important; }
    .arkx-health .bg-rose-50 { background-color: rgba(220,38,38,.12) !important; }
    .arkx-health .bg-emerald-50 { background-color: rgba(16,185,129,.12) !important; }
    .arkx-health .bg-amber-50 { background-color: rgba(245,158,11,.12) !important; }

    .arkx-health .text-slate-900,
    .arkx-health .text-slate-800,
    .arkx-health .text-slate-700 { color: #f5f5f5 !important; }
    .arkx-health .text-slate-600,
    .arkx-health .text-slate-500 { color: #a0a0a0 !important; }
    .arkx-health .text-slate-400,
    .arkx-health .text-slate-300 { color: #7c7c8c !important; }
    .arkx-health .text-indigo-700,
    .arkx-health .text-indigo-600,
    .arkx-health .text-indigo-500 { color: #22c1ff !important; }
    .arkx-health .text-indigo-800 { color: #8fdcff !important; }
    .arkx-health .text-rose-700 { color: #fca5a5 !important; }
    .arkx-health .text-amber-700 { color: #fcd34d !important; }
    .arkx-health .text-emerald-600 { color: #34d399 !important; }

    .arkx-health .border-slate-100,
    .arkx-health .border-slate-200,
    .arkx-health .border-slate-300 { border-color: #1a1a2e !important; }
    .arkx-health .border-indigo-100,
    .arkx-health .border-indigo-200,
    .arkx-health .border-indigo-400 { border-color: rgba(0,168,255,.35) !important; }
    .arkx-health .border-rose-200 { border-color: rgba(220,38,38,.35) !important; }
    .arkx-health .border-amber-200 { border-color: rgba(245,158,11,.35) !important; }
    .arkx-health .ring-indigo-100 { --tw-ring-color: rgba(0,168,255,.22) !important; }

    .arkx-health .hover\\:bg-slate-50:hover { background-color: rgba(255,255,255,.05) !important; }
    .arkx-health .hover\\:bg-slate-100:hover { background-color: rgba(255,255,255,.07) !important; }
    .arkx-health .hover\\:bg-indigo-100:hover { background-color: rgba(0,168,255,.22) !important; }
    .arkx-health .hover\\:text-slate-800:hover { color: #ffffff !important; }
    .arkx-health .hover\\:text-indigo-600:hover,
    .arkx-health .hover\\:text-indigo-800:hover { color: #66d3ff !important; }
    .arkx-health .hover\\:border-slate-300:hover { border-color: #2a2a45 !important; }

    .arkx-health input,
    .arkx-health select,
    .arkx-health textarea {
      background-color: #101024 !important;
      border-color: #1a1a2e !important;
      color: #f5f5f5 !important;
    }
    .arkx-health input::placeholder,
    .arkx-health textarea::placeholder { color: #6f6f80 !important; }
    .arkx-health option { background-color: #0c0c1a; color: #f5f5f5; }

    .arkx-health .profile-name { color: #f5f5f5; }
    .arkx-health .profile-role { color: #a0a0a0; }
    .arkx-health .app-brand span { color: #f5f5f5; }

  `}} />
);

// ============================================================================
// KONFIGURASI SISTEM
// ============================================================================

// ============================================================================
// HELPER COMPONENTS
// ============================================================================
const CopyButton = ({ text, title, label, className }: { text: string, title?: string, label?: string, className?: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {} finally {
        document.body.removeChild(textArea);
      }
    } catch {}
  };

  if (label) {
    return (
      <button 
        onClick={handleCopy} 
        className={className || "flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors shadow-sm"}
        title={title || "Salin ke clipboard"}
      >
        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        {copied ? "Berhasil Disalin!" : label}
      </button>
    );
  }

  return (
    <button 
      onClick={handleCopy} 
      className={className || "p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"} 
      title={title || "Salin ke clipboard"}
    >
      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
    </button>
  );
};

const ProgressBar = ({ progress, loading }: { progress: number; loading: boolean }) => {
  if (!loading && progress === 0) return null;
  return (
    <div className="w-full mt-4 flex flex-col gap-2 anim-fade-in">
      <div className="flex justify-between text-xs text-slate-500 font-bold">
        <span>{progress === 100 ? 'Selesai!' : 'Memproses...'}</span>
        <span>{progress}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
        <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

// ============================================================================
// VIEW: HEALTH ANIM TOOL (MAIN APP)
// ============================================================================
const HealthAnimTool = () => {
  const [activeTab, setActiveTab] = useState('ideas');
  const authToken = useAuthStore((state) => state.token);
  const authUser = useAuthStore((state) => state.user);
  const [appError, setAppError] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  // Pengaturan AI: kunci Gemini dikelola admin di System Settings (app_settings 'studio_gemini_key')
  // dan dipanggil lewat relay /api/public/studio-ai — member tidak pernah menyimpan key sendiri.
  // Pengaturan model di halaman ini hanya bisa diubah admin; member melihat versi read-only.
  const pengaturanDikunci = authUser?.role !== 'admin';
  const [aiModel, setAiModel] = useState(() => { try { return localStorage.getItem('arkxHealthModel') || 'gemini-3.1-flash-lite'; } catch { return 'gemini-3.1-flash-lite'; } });
  const [aiServer, setAiServer] = useState<{ configured: boolean | null; loading: boolean }>({ configured: null, loading: true });
  const [aiDailyCap, setAiDailyCap] = useState<number | null>(null);
  const [aiUsed, setAiUsed] = useState<number | null>(null);
  const saveAiModel = (event: React.FormEvent) => {
    event.preventDefault();
    try { localStorage.setItem('arkxHealthModel', aiModel.trim() || 'gemini-3.1-flash-lite'); } catch {}
    setAiSettingsOpen(false);
  };
  // Status kunci server (terbuka) — dipakai untuk menampilkan aktif/belum di Pengaturan AI & tombol API Key.
  const loadAiStatus = async () => {
    try {
      const r = await fetch('/api/public/studio-ai/status', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      setAiServer({ configured: !!d?.configured, loading: false });
      if (Number.isFinite(Number(d?.dailyCap))) setAiDailyCap(Number(d.dailyCap));
    } catch {
      setAiServer({ configured: null, loading: false });
    }
    try {
      if (!authToken) return;
      const r = await fetch('/api/public/studio-ai/usage', { cache: 'no-store', headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json().catch(() => null);
      if (d?.ok && Number.isFinite(Number(d?.used))) setAiUsed(Number(d.used));
      if (Number.isFinite(Number(d?.dailyCap))) setAiDailyCap(Number(d.dailyCap));
    } catch { /* usage opsional */ }
  };
  useEffect(() => { loadAiStatus(); }, [authToken]);
  // Bersihkan key lama dari sesi tab (era sebelum kunci server) supaya tidak menggantung di browser pengguna.
  useEffect(() => { try { sessionStorage.removeItem('arkxHealthApiKey'); sessionStorage.removeItem('arkxHealthModel'); } catch {} }, []);
  

  // === Riset Ide Konten States ===
  const [ideaTopic, setIdeaTopic] = useState('');
  const [ideaCategory, setIdeaCategory] = useState('Anatomi Tubuh');
  const [ideas, setIdeas] = useState<any[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);

  // === Google Omni Flash: pilih 3/4/6 scene â†’ narasi + prompt tiap scene untuk digenerate di ARKX Studio ===
  const [omniIdea, setOmniIdea] = useState('');
  const [omniHookTechnique, setOmniHookTechnique] = useState('Curiosity Gap');
  const [omniAspectRatio, setOmniAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [omniSceneCount, setOmniSceneCount] = useState(3);
  const [omniScenes, setOmniScenes] = useState<{ scene: number; role: string; voiceover: string; visual: string; video_prompt: string }[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [omniVideo, setOmniVideo] = useState<{ url: string; interactionId: string; aspectRatio: string } | null>(null);
  const [loadingOmni, setLoadingOmni] = useState(false);
  const [omniStatus, setOmniStatus] = useState('');
  // Info diagnosa: model Gemini mana yang dipakai, berapa lama, atau pesan error aslinya.
  const [aiCallInfo, setAiCallInfo] = useState<{ status: 'ok' | 'error'; model: string; ms: number; pesan?: string; dicoba: string[] } | null>(null);
  const [omniConfirmOpen, setOmniConfirmOpen] = useState(false);
  const [omniConfirmMode, setOmniConfirmMode] = useState<'single' | 'batch'>('single');
  const omniVideoUrl = useRef('');
  // â”€â”€ Batch scene: generate 1 video per scene (3/4/6), lalu gabung via ffmpeg â”€â”€
  interface OmniBatchScene { scene: number; role: string; status: 'idle' | 'running' | 'done' | 'error'; url?: string; jobId?: string; error?: string }
  const [omniBatch, setOmniBatch] = useState<OmniBatchScene[]>([]);
  const [loadingOmniBatch, setLoadingOmniBatch] = useState(false);
  const [mergingBatch, setMergingBatch] = useState(false);
  const [omniBatchStatus, setOmniBatchStatus] = useState('');
  const [omniMerged, setOmniMerged] = useState<{ url: string; scenes: number } | null>(null);
  const mergedVideoUrlRef = useRef('');
  const clearOmniVideo = () => {
    if (omniVideoUrl.current) URL.revokeObjectURL(omniVideoUrl.current);
    omniVideoUrl.current = '';
    setOmniVideo(null);
  };
  const clearOmniMerged = () => {
    if (mergedVideoUrlRef.current) URL.revokeObjectURL(mergedVideoUrlRef.current);
    mergedVideoUrlRef.current = '';
    setOmniMerged(null);
  };
  const clearOmniBatch = () => {
    setOmniBatch([]);
    setOmniBatchStatus('');
    clearOmniMerged();
  };
  const clearOmniScenes = () => setOmniScenes([]);
  useEffect(() => () => { if (omniVideoUrl.current) URL.revokeObjectURL(omniVideoUrl.current); if (mergedVideoUrlRef.current) URL.revokeObjectURL(mergedVideoUrlRef.current); }, []);

  // Global Style Selection for Affiliate & Custom
  const [globalPromptStyle, setGlobalPromptStyle] = useState('Microscopic 3D Pixar-style');

  // Other Tabs Data
  const [prompts, setPrompts] = useState<any[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  const [analysisVideo, setAnalysisVideo] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  const [affiliateProductPhoto, setAffiliateProductPhoto] = useState<File | null>(null);
  const [affiliateProductDesc, setAffiliateProductDesc] = useState('');
  const [affiliateIdeas, setAffiliateIdeas] = useState<any[]>([]);
  const [loadingAffiliateIdeas, setLoadingAffiliateIdeas] = useState(false);
  const [affiliateScript, setAffiliateScript] = useState<any[]>([]);
  const [loadingAffiliateScript, setLoadingAffiliateScript] = useState(false);

  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<any>(null);

  const [affiliateNoOverclaim, setAffiliateNoOverclaim] = useState(false);

  // ============================================================================
  // RESET FUNCTIONS (TOMBOL BUAT BARU)
  // ============================================================================
  const resetAffiliate = () => {
    setAffiliateProductPhoto(null);
    setAffiliateProductDesc('');
    setAffiliateIdeas([]);
    setAffiliateScript([]);
    setPrompts([]);
    setProgress(0);
  };

  const resetAnalysis = () => {
    setAnalysisVideo(null);
    setAnalysisResult([]);
    setPrompts([]);
    setProgress(0);
  };

  // NEW: Global Reset Function
  const handleGlobalReset = () => {
    // Reset Ideas
    setIdeaTopic('');
    setIdeas([]);
    
    // Reset Omni
    setOmniIdea('');
    clearOmniVideo();
    clearOmniScenes();
    clearOmniBatch();
    setOmniStatus('');
    setOmniConfirmOpen(false);
    setOmniConfirmMode('single');
    
    // Reset Affiliate
    setAffiliateProductPhoto(null);
    setAffiliateProductDesc('');
    setAffiliateIdeas([]);
    setAffiliateScript([]);
    
    // Reset Analysis
    setAnalysisVideo(null);
    setAnalysisResult([]);
    
    // Reset Prompts
    setPrompts([]);
    
    // Reset Progress & Errors
    setProgress(0);
    setAppError('');
    if (progressInterval.current) clearInterval(progressInterval.current);
    
    // Optional: Reset to first tab
    setActiveTab('ideas');
  };

  useEffect(() => {
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  const startProgress = () => {
    setProgress(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
    progressInterval.current = setInterval(() => {
      setProgress((prev) => Math.min(prev + Math.floor(Math.random() * 8) + 2, 95));
    }, 500);
  };

  const finishProgress = () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
    setTimeout(() => setProgress(0), 2000);
  };

  // Model tercepat yang masih aktif. Kalau model utama sibuk (503), kena limit
  // sementara (429), atau sudah dipensiunkan Google (404), permintaan otomatis
  // pindah ke model berikutnya supaya narasi/prompt tidak gagal total.
  const MODEL_CADANGAN = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-flash-latest'];

  // Model 2.5/3.x "berpikir" dulu sebelum menjawab; itu yang membuat permintaan
  // JSON kecil terasa lama. Setting-nya beda per generasi.
  const thinkingConfigUntuk = (model: string) => {
    if (/^gemini-3/i.test(model)) return { thinkingLevel: 'low' };
    if (/2\.5/i.test(model) && !/pro/i.test(model)) return { thinkingBudget: 128 };
    return null;
  };

  // Panggilan Gemini lewat relay server (/api/public/studio-ai) — kuncinya disimpan
  // admin di app_settings, member Pro/Unlimited/admin boleh memakainya, dengan batas
  // harian per member. Browser tidak pernah memegang kunci Gemini.
  // Relay juga melakukan fallback 404/429 ke model cadangan server-side; percobaan
  // di bawah tetap dipertahankan untuk kegagalan jaringan/validasi skema.
  const callGeminiAPI = async (prompt: string, systemInstruction: string, schema: any, mediaData?: { mimeType: string, data: string }) => {
    const modelDiminta = aiModel.trim() || 'gemini-3.1-flash-lite';
    if (!/^[a-zA-Z0-9._-]+$/.test(modelDiminta)) throw new Error('Nama model Gemini tidak valid.');
    const daftarModel = [...new Set([modelDiminta, ...MODEL_CADANGAN])];

    if (!authToken) {
      setAiSettingsOpen(true);
      throw new Error('Sesi login tidak dikenali — login ulang lalu coba lagi.');
    }

    const parts: any[] = [{ text: prompt }];
    if (mediaData) {
      parts.push({ inlineData: { mimeType: mediaData.mimeType, data: mediaData.data } });
    }

    const mulai = Date.now();
    const batasTotal = 100000;
    let pesanTerakhir = '';
    let modelTerakhir = '';
    const dicoba: string[] = [];

    for (const model of daftarModel) {
      modelTerakhir = model;
      dicoba.push(model);
      // Kalau model menolak setting thinking, ulangi model yang sama tanpa itu.
      let thinkingConfig = thinkingConfigUntuk(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (Date.now() - mulai > batasTotal) break;
        try {
          const res = await fetch(`/api/public/studio-ai/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({
              contents: [{ parts }],
              systemInstruction: { parts: [{ text: systemInstruction }] },
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                ...(thinkingConfig ? { thinkingConfig } : {}),
              },
            }),
            // Batas per percobaan: model yang macet tidak boleh menggantung halaman.
            signal: AbortSignal.timeout(40000),
          });

          if (res.ok) {
            const result = await res.json();
            const text = (result.candidates?.[0]?.content?.parts || [])
              .filter((p: any) => !p.thought)
              .map((p: any) => p.text || '')
              .join('');
            if (!text) {
              pesanTerakhir = `Model ${model} mengembalikan jawaban kosong.`;
              break;
            }
            try {
              const hasil = JSON.parse(text);
              setAiCallInfo({ status: 'ok', model, ms: Date.now() - mulai, dicoba: [...dicoba] });
              setAiUsed((u) => (u == null ? u : u + 1));
              return hasil;
            } catch {
              pesanTerakhir = `Format jawaban model ${model} tidak valid.`;
              break;
            }
          }

          const err = await res.json().catch(() => null);
          const pesan = err?.error?.message || `HTTP ${res.status}`;
          pesanTerakhir = pesan;

          if (res.status === 400 && thinkingConfig && /thinking/i.test(pesan)) {
            thinkingConfig = null;
            attempt--;
            continue;
          }
          if (res.status === 404) break; // model dipensiunkan â†’ langsung model berikutnya
          if (res.status === 429 || res.status >= 500) {
            if (attempt < 1 && Date.now() - mulai < batasTotal) {
              await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700));
              continue;
            }
            break;
          }
          break; // 4xx lain (key/izin/skema) â†’ coba model berikutnya
        } catch (error: any) {
          if (error?.name === 'TimeoutError') {
            pesanTerakhir = `Model ${model} tidak menjawab dalam 40 detik.`;
            break;
          }
          pesanTerakhir = String(error?.message || 'Gagal menghubungi Gemini.');
          if (attempt < 1) {
            await new Promise(resolve => setTimeout(resolve, 700));
            continue;
          }
          break;
        }
      }
    }

    setAiCallInfo({ status: 'error', model: modelTerakhir, ms: Date.now() - mulai, pesan: pesanTerakhir, dicoba: [...dicoba] });

    if (/Pro \/ Unlimited/i.test(pesanTerakhir)) {
      throw new Error('Fitur ini memakai kunci Gemini server dan hanya tersedia untuk member Pro / Unlimited. Upgrade ke Pro dulu agar bisa generate.');
    }
    if (/studio_gemini_key|Kunci Gemini server belum diisi/i.test(pesanTerakhir)) {
      setAiSettingsOpen(true);
      throw new Error('Kunci Gemini server belum diisi admin. Hubungi admin untuk mengisi "studio_gemini_key" di System Settings → AI Studio (Gemini).');
    }
    if (/Batas AI Studio hari ini tercapai/i.test(pesanTerakhir)) {
      throw new Error(pesanTerakhir);
    }
    if (/Sesi login tidak dikenali/i.test(pesanTerakhir)) {
      setAiSettingsOpen(true);
      throw new Error('Sesi login tidak dikenali — login ulang lalu coba lagi.');
    }
    if (/quota|billing|prepayment/i.test(pesanTerakhir)) {
      throw new Error('Limit API Gemini Anda sedang penuh. Tunggu beberapa menit lalu coba lagi.');
    }
    throw new Error(`Narasi/prompt gagal dibuat: ${pesanTerakhir || 'semua model Gemini tidak merespons.'} Coba lagi sebentar lagi.`);
  };

  const handleApiError = (error: any, defaultMessage: string) => {
    const errorMessage = error?.message || defaultMessage;
    setAppError(errorMessage.toLowerCase().includes('quota') ? "âš ï¸ Limit API Gemini Anda telah tercapai." : `âŒ ${errorMessage}`);
    setTimeout(() => setAppError(''), 8000);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  // ============================================================================
  // RISET IDE KONTEN COMPREHENSIVE
  // ============================================================================
  const generateIdeas = async (isMore = false) => {
    if (!ideaTopic) return; 
    setLoadingIdeas(true); 
    startProgress(); 
    setAppError('');
    
    try {
      const promptText = `
      Lakukan riset mendalam sebagai Pakar SEO YouTube dan TikTok Indonesia. 
      Cari 4 Ide Konten Viral seputar "${ideaTopic}" dalam kategori "${ideaCategory}".
      
      PENTING:
      - Analisa tren pencarian masyarakat Indonesia terkait topik ini.
      - Berikan Hook (kalimat pertama pembuka video) yang sangat memancing rasa penasaran atau emosi (jangan kaku). Sesuaikan gaya bahasa Hook dan narasi agar natural dan secara otomatis menyesuaikan dengan konteks topik (misal: jika topiknya kesehatan wanita, gunakan gaya bahasa yang pas untuk audiens wanita, dsb).
      - PENTING MUTLAK: DILARANG KERAS membuat deskripsi visual dengan wujud manusia. Visual HARUS selalu berupa karakter animasi biologi/organ di dalam tubuh.
      - Berikan deskripsi visual kasar untuk video 3D Animasi.
      - Berikan alasan rasional mengapa ide ini memiliki potensi viral (berdasarkan masalah umum/psikologi audiens).
      - Jika ada ide yang sudah pernah di-generate sebelumnya, berikan ide ${isMore ? 'YANG BARU DAN BERBEDA DARI SEBELUMNYA' : 'yang fresh'}.
      `;

      const systemInstruction = "Anda adalah Pakar SEO Konten Medis & Kesehatan Viral di Indonesia. Berikan output dalam bahasa Indonesia yang luwes dan mudah dimengerti.";
      
      const schema = {
        type: Type.OBJECT,
        properties: {
          ideas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                hook: { type: Type.STRING },
                visual_idea: { type: Type.STRING },
                viral_reason: { type: Type.STRING }
              },
              required: ["title", "hook", "visual_idea", "viral_reason"]
            }
          }
        },
        required: ["ideas"]
      };

      const parsed = await callGeminiAPI(promptText, systemInstruction, schema);
      if (parsed?.ideas) {
        if (isMore) {
          setIdeas(prev => [...prev, ...parsed.ideas]);
        } else {
          setIdeas(parsed.ideas);
        }
      }
    } catch (e) { 
      handleApiError(e, "Gagal meriset ide konten."); 
    } finally { 
      finishProgress(); 
      setLoadingIdeas(false); 
    }
  };

  // ============================================================================
  // GOOGLE OMNI FLASH VIDEO â€” paid request requires a separate confirmation
  // ============================================================================
  const generateOmniFlash = () => {
    if (!omniIdea.trim() || loadingOmni || loadingOmniBatch) return;
    setAppError('');
    if (!authToken) {
      setAppError('Login dulu untuk membuat video dengan saldo NexaBot.');
      return;
    }
    setOmniConfirmMode('single');
    setOmniConfirmOpen(true);
  };

  const confirmOmniFlash = async () => {
    if (loadingOmni) return;
    setOmniConfirmOpen(false);
    setLoadingOmni(true);
    setAppError('');
    clearOmniVideo();
    const token = authToken;
    if (!token) {
      setAppError('Login dulu untuk membuat video dengan saldo NexaBot.');
      setLoadingOmni(false);
      return;
    }
    const admin = authUser?.role === 'admin';
    let tiketPotong: number | null = null;
    let jobTerakhir = '';
    // Daftarkan sebagai task berjalan: KeepAliveRoutes tidak akan membuang tab
    // ini saat user pindah menu, dan header menampilkan progresnya. Task ini
    // ephemeral (poll NexaBot tidak bisa dilanjutkan setelah reload).
    const taskId = startGenerationTask({
      page: 'arkx-health',
      model: 'Omni Flash 1.2',
      prompt: omniIdea.trim(),
      provider: 'nexabot',
    });
    try {
      // 1/3 â€” potong saldo NexaBot (gratis untuk admin / paket Unlimited).
      if (!admin) {
        setOmniStatus('Memotong saldo NexaBot...');
        const potong = await chargeNexabotWallet(token, 't2v');
        tiketPotong = potong.usageId ?? null;
        if (!potong.unlimited && potong.deducted > 0) {
          setOmniStatus(`Saldo NexaBot terpotong ${new Intl.NumberFormat('id-ID').format(potong.deducted)}.`);
        }
      }

      // 2/3 â€” submit + poll + simpan hasil, semuanya lewat relay NexaBot.
      const url = await runNexabotJobWithSessionFallback<string>(
        async (auth, via) => {
          setOmniStatus(`Mengirim permintaan video ke NexaBot (${via})...`);
          const submit = await runWithNexabotThrottleRetry(
            () =>
              submitNexabot(
                {
                  mode: 't2v',
                  prompt: omniIdea.trim(),
                  // Upstream: ratio 1 = 16:9, 2 = 9:16.
                  ratio: omniAspectRatio === '9:16' ? 2 : 1,
                  resolution: 720,
                  duration: 15
                },
                auth,
                {
                  onRetry: ({ status, delayMs, message }) => {
                    setOmniStatus(`${message}${status ? ` (HTTP ${status})` : ''} â€” submit diulang dalam ${Math.ceil(delayMs / 1000)}s...`);
                  }
                }
              ),
            {
              onThrottle: (waitSeconds) => {
                setOmniStatus(`Server NexaBot sedang dibatasi upstream â€” menunggu ${waitSeconds}s lalu submit otomatis...`);
              }
            }
          );
          if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot gagal membuat job video.');
          jobTerakhir = submit.jobId;

          setOmniStatus('Video sedang dibuat NexaBot (biasanya 1-3 menit)...');
          await pollNexabotJob(
            submit.jobId,
            auth,
            (msg) => setOmniStatus(msg),
            {
              onRetry: ({ status, delayMs, message }) => {
                setOmniStatus(`${message}${status ? ` (HTTP ${status})` : ''} â€” coba lagi dalam ${Math.ceil(delayMs / 1000)}s...`);
              }
            }
          );

          // 3/3 â€” simpan permanen di server; fallback ke URL unduhan NexaBot.
          setOmniStatus('Menyimpan video ke server...');
          const saved = await saveNexabotResult(submit.jobId, auth, `arkx-health-${submit.jobId}.mp4`);
          if (saved.ok && saved.url) return saved.url;

          const unduh = await downloadNexabotResult(submit.jobId, auth);
          if (!unduh.ok || !unduh.url) throw new Error(unduh.error || 'Hasil video NexaBot tidak bisa diunduh.');
          return unduh.url;
        },
        {
          master: true,
          ticket: tiketPotong,
          hooks: {
            log: (msg, level) => console.log('[arkx-health/nexabot]', level || 'info', msg),
            notify: () => {}
          }
        }
      );

      if (url.startsWith('blob:')) omniVideoUrl.current = url;
      setOmniVideo({ url, interactionId: jobTerakhir, aspectRatio: omniAspectRatio });
      setOmniStatus('Video siap diputar dan diunduh.');
    } catch (error: any) {
      const pesan = error?.message || 'Pembuatan video belum berhasil.';
      // Gagal di tengah jalan â†’ kembalikan saldo yang sudah terpotong.
      let catatanRefund = '';
      if (tiketPotong != null && !admin) {
        const sisa = await refundNexabotWallet(token, tiketPotong).catch(() => null);
        if (sisa !== null) catatanRefund = ' Saldo NexaBot yang terpotong sudah dikembalikan.';
      }
      setAppError(`${pesan}${catatanRefund}`);
      setOmniStatus('');
    } finally {
      removeActiveTask(taskId);
      setLoadingOmni(false);
    }
  };

  // ============================================================================
  // BATCH SCENE: N scene (3/4/6) â†’ N video 15 detik (1 per scene, berurutan)
  // â†’ gabung otomatis via ffmpeg.wasm menjadi satu video NÃ—15 detik.
  // Setiap scene memotong saldo NexaBot sendiri (Rp 150/video, gratis untuk
  // admin/Unlimited) dan di-refund otomatis bila gagal.
  // ============================================================================
  const generateOmniBatch = () => {
    if (loadingOmniBatch || loadingOmni || loadingScenes) return;
    if (omniScenes.length === 0) return;
    setAppError('');
    if (!authToken) {
      setAppError('Login dulu untuk membuat video dengan saldo NexaBot.');
      return;
    }
    setOmniConfirmMode('batch');
    setOmniConfirmOpen(true);
  };

  // Satu job video dari sebuah prompt scene (charge â†’ submit â†’ poll â†’ save).
  // Mengurus saldonya sendiri: di-refund bila gagal.
  const runOmniBatchScene = async (videoPrompt: string, onStatus: (msg: string) => void): Promise<{ url: string; jobId: string }> => {
    const token = authToken;
    if (!token) throw new Error('Login dulu untuk membuat video dengan saldo NexaBot.');
    const admin = authUser?.role === 'admin';
    let tiketPotong: number | null = null;
    let jobTerakhir = '';
    try {
      if (!admin) {
        onStatus('Memotong saldo NexaBotâ€¦');
        const potong = await chargeNexabotWallet(token, 't2v');
        tiketPotong = potong.usageId ?? null;
      }
      const url = await runNexabotJobWithSessionFallback<string>(
        async (auth, via) => {
          onStatus(`Mengirim prompt scene ke NexaBot (${via})â€¦`);
          const submit = await runWithNexabotThrottleRetry(
            () =>
              submitNexabot(
                {
                  mode: 't2v',
                  prompt: videoPrompt,
                  // Upstream: ratio 1 = 16:9, 2 = 9:16.
                  ratio: omniAspectRatio === '9:16' ? 2 : 1,
                  resolution: 720,
                  duration: 15
                },
                auth,
                {
                  onRetry: ({ status, delayMs, message }) => {
                    onStatus(`${message}${status ? ` (HTTP ${status})` : ''} â€” submit diulang dalam ${Math.ceil(delayMs / 1000)}sâ€¦`);
                  }
                }
              ),
            {
              onThrottle: (waitSeconds) => onStatus(`Server NexaBot dibatasi upstream â€” menunggu ${waitSeconds}s lalu submit otomatisâ€¦`),
            }
          );
          if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot gagal membuat job video.');
          jobTerakhir = submit.jobId;

          onStatus('Video sedang dibuat NexaBot (biasanya 1-3 menit)â€¦');
          await pollNexabotJob(
            submit.jobId,
            auth,
            (msg) => onStatus(msg),
            {
              onRetry: ({ status, delayMs, message }) => {
                onStatus(`${message}${status ? ` (HTTP ${status})` : ''} â€” coba lagi dalam ${Math.ceil(delayMs / 1000)}sâ€¦`);
              }
            }
          );

          onStatus('Menyimpan video ke serverâ€¦');
          const saved = await saveNexabotResult(submit.jobId, auth, `arkx-health-${submit.jobId}.mp4`);
          if (saved.ok && saved.url) return saved.url;

          const unduh = await downloadNexabotResult(submit.jobId, auth);
          if (!unduh.ok || !unduh.url) throw new Error(unduh.error || 'Hasil video NexaBot tidak bisa diunduh.');
          return unduh.url;
        },
        {
          master: true,
          ticket: tiketPotong,
          hooks: {
            log: (msg, level) => console.log('[arkx-health/batch]', level || 'info', msg),
            notify: () => {}
          }
        }
      );
      return { url, jobId: jobTerakhir };
    } catch (error: any) {
      if (tiketPotong != null && !admin) await refundNexabotWallet(token, tiketPotong).catch(() => null);
      throw error;
    }
  };

  const mergeBatchVideos = async (urls: string[]) => {
    if (urls.length < 2) return;
    setMergingBatch(true);
    setAppError('');
    try {
      const files: File[] = [];
      for (let i = 0; i < urls.length; i++) {
        setOmniBatchStatus(`Mengunduh scene ${i + 1}/${urls.length} untuk digabungâ€¦`);
        files.push(await fetchVideoFile(urls[i], `scene_${i + 1}.mp4`));
      }
      setOmniBatchStatus('Menggabungkan semua scene via ffmpegâ€¦');
      const merged = await concatVideosFFmpeg(files, (msg) => setOmniBatchStatus(msg));
      const mergedUrl = URL.createObjectURL(merged);
      if (mergedVideoUrlRef.current) URL.revokeObjectURL(mergedVideoUrlRef.current);
      mergedVideoUrlRef.current = mergedUrl;
      setOmniMerged({ url: mergedUrl, scenes: urls.length });
      setOmniBatchStatus(`Gabungan ${urls.length} scene selesai â€” ${urls.length * 15} detik.`);
    } catch (e: any) {
      setAppError(`Video per scene berhasil dibuat, tetapi gagal digabung: ${e?.message || e}. Masing-masing scene bisa diunduh terpisah di bawah.`);
      setOmniBatchStatus('');
    } finally {
      setMergingBatch(false);
    }
  };

  // Loop berurutan atas index scene yang diminta; gabung otomatis bila SEMUA
  // scene berhasil (termasuk hasil retry). State di-update papan ke papan.
  const runOmniBatchLoop = async (indexes: number[], base: OmniBatchScene[]) => {
    const total = omniScenes.length;
    const next = base.map(b => ({ ...b }));
    const taskId = startGenerationTask({
      page: 'arkx-health',
      model: 'Omni Flash 1.2 (video per scene)',
      prompt: omniIdea.trim(),
      provider: 'nexabot',
    });
    try {
      for (const i of indexes) {
        const scene = omniScenes[i];
        if (!scene) continue;
        next[i] = { ...next[i], status: 'running', error: undefined };
        setOmniBatch([...next]);
        try {
          const { url, jobId } = await runOmniBatchScene(scene.video_prompt, (m) => setOmniBatchStatus(`Scene ${i + 1}/${total}: ${m}`));
          next[i] = { ...next[i], status: 'done', url, jobId, error: undefined };
        } catch (e: any) {
          next[i] = { ...next[i], status: 'error', error: e?.message || 'Gagal membuat video.' };
        }
        setOmniBatch([...next]);
      }
      const doneUrls = next.filter(b => b.status === 'done' && b.url).map(b => b.url as string);
      if (doneUrls.length === total && total >= 2) {
        await mergeBatchVideos(doneUrls);
      } else if (doneUrls.length === total) {
        setOmniBatchStatus('Scene selesai â€” unduh hasilnya di bawah.');
      } else {
        setOmniBatchStatus(`${doneUrls.length}/${total} scene berhasil. Ulangi scene yang gagal, atau gabungkan ${doneUrls.length} scene yang jadi (minimal 2).`);
      }
    } finally {
      removeActiveTask(taskId);
      setLoadingOmniBatch(false);
    }
  };

  const confirmOmniBatch = async () => {
    if (loadingOmniBatch) return;
    setOmniConfirmOpen(false);
    setLoadingOmniBatch(true);
    setAppError('');
    clearOmniMerged();
    setOmniBatch(omniScenes.map((s) => ({ scene: s.scene, role: s.role, status: 'idle' as const })));
    const base = omniScenes.map((s) => ({ scene: s.scene, role: s.role, status: 'idle' as const }));
    await runOmniBatchLoop(omniScenes.map((_, i) => i), base);
  };

  const retryFailedScenes = async () => {
    if (loadingOmniBatch) return;
    const failedIdx = omniBatch.map((b, i) => (b.status === 'error' ? i : -1)).filter((i) => i >= 0);
    if (failedIdx.length === 0) return;
    setLoadingOmniBatch(true);
    setAppError('');
    await runOmniBatchLoop(failedIdx, omniBatch);
  };

  // Pilihan 3/4/6 scene = narasi + prompt video tiap scene. Sejak tombol video
  // beralih ke mode batch: menekan "Buat Video â€¦ Scene" menghasilkan 1 video
  // per scene (15 detik) lalu menggabungkannya otomatis jadi satu video NÃ—15.
  const generateOmniScenes = async () => {
    if (!omniIdea.trim() || loadingScenes) return;
    setAppError('');
    if (aiServer.configured === false) {
      setAiSettingsOpen(true);
      setAppError('Kunci Gemini server belum diisi admin. Hubungi admin — fitur generasi belum bisa dipakai.');
      return;
    }
    setLoadingScenes(true);
    const mulai = Date.now();
    setOmniStatus('0 detik');
    const detak = setInterval(() => setOmniStatus(`${Math.round((Date.now() - mulai) / 1000)} detik`), 1000);
    try {
      const prompt = `Buat rencana ${omniSceneCount} scene untuk video kesehatan edukatif berdurasi 15 detik per scene.
Topik / ide: ${omniIdea.trim()}
Gaya visual: ${globalPromptStyle}
Teknik hook untuk scene 1: ${omniHookTechnique}
Rasio video target: ${omniAspectRatio}

ATURAN MUTLAK:
1. Tepat ${omniSceneCount} scene, bernomor 1 sampai ${omniSceneCount}.
2. Scene 1 = HOOK yang menghentikan scroll. Scene ${omniSceneCount} = CTA singkat. Scene di antaranya = BODY, satu poin penjelasan per scene.
3. Latar visual SELALU di dalam tubuh manusia (pembuluh darah, organ, jaringan) dengan karakter organ/sel lucu; bukan manusia asli dan tidak ada orang berbicara.
4. voiceover: bahasa Indonesia, kalimat pendek yang muat diucapkan dalam 15 detik.
5. visual: deskripsi visual scene dalam Bahasa Indonesia.
6. video_prompt: prompt sinematik BAHASA INGGRIS untuk video generator, satu paragraf, sebutkan kamera, gerakan kamera, lighting, dan durasi 15 detik.
7. Tanpa diagnosis, janji kesembuhan, atau klaim kesehatan berlebihan.`;
      const systemInstruction = 'Anda penulis skrip video kesehatan vertikal. Output JSON sesuai skema. Narasi dalam Bahasa Indonesia, prompt video dalam Bahasa Inggris.';
      const schema = {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene: { type: Type.NUMBER },
                role: { type: Type.STRING },
                voiceover: { type: Type.STRING },
                visual: { type: Type.STRING },
                video_prompt: { type: Type.STRING }
              },
              required: ["scene", "role", "voiceover", "visual", "video_prompt"]
            }
          }
        },
        required: ["scenes"]
      };
      const parsed = await callGeminiAPI(prompt, systemInstruction, schema);
      const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
      if (!scenes.length) throw new Error('Gemini tidak mengembalikan scene. Coba topik yang lebih spesifik.');
      setOmniScenes(scenes.slice(0, omniSceneCount).map((scene: any, index: number) => ({
        scene: Number(scene?.scene) || index + 1,
        role: String(scene?.role || (index === 0 ? 'Hook' : index === omniSceneCount - 1 ? 'CTA' : 'Penjelasan')),
        voiceover: String(scene?.voiceover || ''),
        visual: String(scene?.visual || ''),
        video_prompt: String(scene?.video_prompt || '')
      })));
    } catch (error: any) {
      handleApiError(error, 'Gagal membuat narasi dan prompt scene.');
    } finally {
      clearInterval(detak);
      setOmniStatus('');
      setLoadingScenes(false);
    }
  };

  const generateAffiliateIdeas = async (isMore = false) => {
    if (!affiliateProductDesc && !affiliateProductPhoto) {
      setAppError("Silakan masukkan deskripsi produk atau upload foto produk.");
      return;
    }
    
    setLoadingAffiliateIdeas(true);
    startProgress();
    setAppError('');
    try {
      let mediaData;
      if (affiliateProductPhoto) {
        if (affiliateProductPhoto.size > 10 * 1024 * 1024) {
          throw new Error("Ukuran foto terlalu besar. Maksimal 10MB.");
        }
        const base64 = await fileToBase64(affiliateProductPhoto);
        mediaData = { mimeType: affiliateProductPhoto.type, data: base64 };
      }

      const prompt = affiliateProductPhoto && !affiliateProductDesc 
        ? `Analisa foto produk ini dan berikan 3 ide konten affiliate kreatif ${isMore ? 'yang berbeda dari sebelumnya ' : ''}untuk menjual produk ini. Output dalam Bahasa Indonesia. PENTING: Setting lokasi animasi HARUS SELALU berada DI DALAM TUBUH MANUSIA (misal: di dalam usus berdaging, pembuluh darah, lambung).`
        : `Generate 3 creative affiliate content ideas ${isMore ? 'that are different from previous ones ' : ''}for this product: ${affiliateProductDesc}. The goal is to sell the product at the end. Output in Indonesian. CRITICAL: The video setting MUST ALWAYS be INSIDE the human body (e.g., inside veins, stomach, organic tissues).`;
      
      const systemInstruction = "Expert affiliate marketing content creator. Provide creative ideas for 3D animation videos set strictly inside the human body. Output in Indonesian.";
      const schema = {
        type: Type.OBJECT,
        properties: {
          ideas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["title", "description"]
            }
          }
        },
        required: ["ideas"]
      };

      const parsed = await callGeminiAPI(prompt, systemInstruction, schema, mediaData);
      if (parsed?.ideas) {
        if (isMore) {
          setAffiliateIdeas(prev => [...prev, ...parsed.ideas]);
        } else {
          setAffiliateIdeas(parsed.ideas);
        }
      }
    } catch (e) {
      handleApiError(e, "Gagal membuat ide affiliate.");
    } finally {
      finishProgress();
      setLoadingAffiliateIdeas(false);
    }
  };

  const generateAffiliateScript = async (idea: any) => {
    setLoadingAffiliateScript(true);
    startProgress();
    setAppError('');
    try {
      let mediaData;
      if (affiliateProductPhoto) {
        const base64 = await fileToBase64(affiliateProductPhoto);
        mediaData = { mimeType: affiliateProductPhoto.type, data: base64 };
      }

      const prompt = `Create a scene-by-scene script for this affiliate content idea: ${idea.title} - ${idea.description}. Product: ${affiliateProductDesc}. Include visual descriptions and voiceover. Refer to the attached product photo for visual accuracy. CRITICAL RULE: The visual descriptions MUST ALWAYS be set strictly INSIDE the human body (e.g., microscopic fleshy tunnels, veins, stomach).`;
      
      const overclaimInstruction = affiliateNoOverclaim ? `
      ATURAN ANTI-OVERCLAIM SANGAT KETAT (WAJIB DIPATUHI UNTUK TIKTOK/SOSMED):
      1. DILARANG KERAS menggunakan kata: "Menyembuhkan", "Mengobati", "Pasti sembuh", "100% ampuh", "Menghancurkan penyakit", "Solusi total".
      2. WAJIB MENGGUNAKAN DIKSI AMAN: "Membantu menjaga kesehatan", "Membantu memelihara daya tahan tubuh", "Membantu meredakan keluhan ringan", "Secara tradisional digunakan untuk...", "Mendukung kenyamanan tubuh".
      3. GUNAKAN FORMULA COPYWRITING INI PADA VOICEOVER: Masalah -> Edukasi -> Solusi Halus -> Disclaimer.
      4. Jangan pernah menjanjikan hasil pasti, berikan disclaimer bahwa "hasil bisa berbeda pada setiap orang" atau "diimbangi pola hidup sehat".
      5. Pendekatan narasi harus edukatif dan 'soft selling', BUKAN 'hard selling' medis.
      ` : "";
      
      const systemInstruction = `Anda adalah expert scriptwriter konten edukasi dan affiliate marketing dari Indonesia yang SANGAT PAHAM ATURAN TIKTOK. Tulis narasi voiceover menggunakan Bahasa Indonesia tulen dengan gaya penceritaan yang seru, natural, kekinian. Gaya bahasa dan kosakata Voice Over HARUS otomatis menyesuaikan dengan target audiens dan produk (misal: jika produk kewanitaan, gunakan gaya bahasa yang relevan, dsb).
      ATURAN MUTLAK: Visual di scene HARUS TETAP berlatar di dalam tubuh manusia dengan karakter pekerja biologi/organ, BUKAN visualisasi manusia asli. Maksimal 5 scenes.` + overclaimInstruction;
      
      const schema = {
        type: Type.OBJECT,
        properties: {
          script: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene: { type: Type.NUMBER },
                visual: { type: Type.STRING },
                voiceover: { type: Type.STRING }
              },
              required: ["scene", "visual", "voiceover"]
            }
          }
        },
        required: ["script"]
      };

      const parsed = await callGeminiAPI(prompt, systemInstruction, schema, mediaData);
      if (parsed?.script) {
        setAffiliateScript(parsed.script);
      }
    } catch (e) {
      handleApiError(e, "Gagal membuat naskah affiliate.");
    } finally {
      finishProgress();
      setLoadingAffiliateScript(false);
    }
  };

  const generateAffiliatePrompts = async () => {
    if (affiliateScript.length === 0) return;
    setLoadingPrompts(true);
    startProgress();
    setAppError('');
    try {
      let mediaData;
      if (affiliateProductPhoto) {
        const base64 = await fileToBase64(affiliateProductPhoto);
        mediaData = { mimeType: affiliateProductPhoto.type, data: base64 };
      }

      const scriptText = affiliateScript.map(s => `Scene ${s.scene}:\nVisual: ${s.visual}\nVoiceover: ${s.voiceover}`).join('\n\n');
      const prompt = `Generate high-quality, visually stunning image prompts AND extremely minimal MOTION-ONLY video prompts in ENGLISH based on this script:\n${scriptText}. 
      Character & Art Style MUST BE: "${globalPromptStyle}".
      
      RULES:
      - The MAIN CHARACTER MUST BE a cute, anthropomorphic representation of the SPECIFIC HEALTH TOPIC or ORGAN being discussed (e.g., cute heart, cute stomach). 
      - Background Environment: STRICTLY INSIDE THE HUMAN BODY (e.g., fleshy intestines, blood vessels). Use macro photography style.
      
      Use the attached product photo as the primary visual reference.
      
      IMPORTANT: 
      1. Aspect ratio 9:16.
      2. If the scene involves the product, the character MUST be explicitly described as HOLDING the product in their hands. Set "holding_product" to true.
      3. For "video_prompt", write extremely minimal MOTION-ONLY prompts for AI Video generators (Luma/Kling). DO NOT describe appearance or background in the video_prompt, only camera movement and subject action (e.g., "The main character walks forward confidently. The camera slowly zooms in.").`;
      
      const systemInstruction = "Expert AI prompt engineer. Provide detailed image prompts AND concise video motion prompts in ENGLISH. Voiceover remains in Indonesian.";
      const schema = {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene: { type: Type.NUMBER },
                duration_seconds: { type: Type.NUMBER },
                image_prompt: { type: Type.STRING },
                video_prompt: { type: Type.STRING },
                voiceover: { type: Type.STRING },
                holding_product: { type: Type.BOOLEAN }
              },
              required: ["scene", "duration_seconds", "image_prompt", "video_prompt", "voiceover", "holding_product"]
            }
          }
        },
        required: ["prompts"]
      };

      const parsed = await callGeminiAPI(prompt, systemInstruction, schema, mediaData);
      if (parsed?.prompts) {
        setPrompts(parsed.prompts);
        setActiveTab('prompts');
      }
    } catch (e) {
      handleApiError(e, "Gagal membuat prompts affiliate.");
    } finally {
      finishProgress();
      setLoadingPrompts(false);
    }
  };

  const generateAnalysis = async () => {
    if (!analysisVideo) return;
    setLoadingAnalysis(true);
    startProgress();
    setAppError('');
    try {
      const base64Data = await fileToBase64(analysisVideo);
      const mimeType = analysisVideo.type;

      const parsed = await callGeminiAPI(
        `Analisa video ini dan berikan detail untuk setiap scene. Berikan output berupa video prompt untuk AI generator, deskripsi background, dan teks/voiceover yang sesuai. PENTING: Deskripsikan background sebagai lingkungan biologi organik DI DALAM TUBUH MANUSIA (berdaging, pembuluh darah, dinding sel, dll). Untuk teks/voiceover, sesuaikan gaya bahasanya secara otomatis agar relevan dengan konteks video dan audiens targetnya. PENTING MUTLAK: Deskripsi background dan video prompt HARUS TETAP fokus pada lingkungan biologi organik di dalam tubuh manusia dan BUKAN memvisualisasikan wujud manusia.`,
        "Anda adalah pakar analisa konten video. Pecah video menjadi beberapa scene. Untuk setiap scene, berikan: video_prompt (instruksi detail untuk AI video generator), background_description (deskripsi latar belakang), dan text_content (teks atau voiceover). Output dalam Bahasa Indonesia.",
        {
          type: Type.OBJECT,
          properties: {
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scene_number: { type: Type.NUMBER },
                  video_prompt: { type: Type.STRING },
                  background_description: { type: Type.STRING },
                  text_content: { type: Type.STRING }
                },
                required: ["scene_number", "video_prompt", "background_description", "text_content"]
              }
            }
          },
          required: ["scenes"]
        },
        { mimeType, data: base64Data }
      );

      if (parsed?.scenes) setAnalysisResult(parsed.scenes);
    } catch (e) {
      handleApiError(e, "Gagal menganalisa video. Pastikan ukuran file tidak terlalu besar.");
    } finally {
      finishProgress();
      setLoadingAnalysis(false);
    }
  };

  const steps = [
    { id: 'ideas', name: '1. Riset Ide Konten', icon: Lightbulb },
    { id: 'affiliate', name: '2. Animasi Affiliate', icon: ShoppingBag },
    { id: 'analyze', name: '3. Analisa Konten', icon: ScanSearch },
    { id: 'omni_flash', name: '4. Omni Flash AI', icon: Zap },
    { id: 'prompts', name: '5. Video Prompts', icon: ImageIcon },
  ];

  return (
    <>
    <div className="arkx-health min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="arkx-header sticky top-0 z-30 border-b border-slate-200 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex min-h-[64px] flex-wrap items-center gap-2 py-2.5 sm:gap-3">
            <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50" title="Kembali ke menu Dashboard">
              <ArrowLeft className="h-4 w-4 text-indigo-500" /> <span className="hidden sm:inline">Dashboard</span>
            </Link>

            <div className="ml-1 flex items-center gap-2.5">
              <div aria-hidden="true" className="brand-globe" />
              <div className="leading-tight">
                <div className="text-sm font-extrabold tracking-tight text-slate-900">ARKX Health Animasi</div>
                <div className="hidden text-[11px] font-medium text-slate-500 sm:block">Riset ide Â· animasi Â· prompt video</div>
              </div>
            </div>

            <span className="hidden items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 lg:inline-flex">
              <Sparkles className="h-3 w-3" /> Omni Flash 15 detik
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => { loadAiStatus(); setAiSettingsOpen(true); }} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-bold transition-all ${aiServer.configured ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-amber-200 bg-amber-50 text-amber-700'}`} title={aiServer.configured ? 'Kunci Gemini server aktif — fitur generasi siap' : 'Kunci Gemini server belum diisi admin'}>
                <KeyRound className="h-4 w-4" />
                <span className="sm:hidden">API Key</span>
                <span className="hidden sm:inline">Kunci Server</span>
                <span className="hidden text-[10px] uppercase tracking-wider sm:inline">{aiServer.configured === null ? '…' : (aiServer.configured ? 'siap' : 'belum')}</span>
              </button>
              <button onClick={handleGlobalReset} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50" title="Mulai Ulang">
                <Sparkles className="h-4 w-4 text-indigo-500" /> <span className="hidden sm:inline">Mulai Ulang</span>
              </button>
            </div>
          </div>

          <nav className="arkx-tabs flex gap-1.5 overflow-x-auto px-0.5 pb-2.5" aria-label="Langkah kerja">
            {steps.map(step => {
              const aktif = activeTab === step.id;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveTab(step.id)}
                  aria-current={aktif ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${aktif ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-800'}`}
                >
                  <step.icon className={`h-4 w-4 ${aktif ? 'text-indigo-600' : 'text-slate-400'}`} />{step.name}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6">
        {appError && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{appError}</p>
          </div>
        )}

            {activeTab === 'ideas' && (
              <div className="space-y-6" data-feature="ideas">
                <div className="workspace-panel bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Riset Ide Konten</h2>
                  <p className="text-sm font-medium text-slate-500 mb-8">Masukkan topik kesehatan, AI akan membuatkan ide konten viral dengan narasi yang telah disesuaikan persona.</p>
                  
                  <div className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4 mb-4">
                      <div>
                         <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Topik Spesifik</label>
                         <input aria-label="Topik Spesifik" type="text" value={ideaTopic} onChange={(e) => setIdeaTopic(e.target.value)} placeholder="Contoh: Manfaat air kelapa..." className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all" onKeyDown={e => e.key === 'Enter' && generateIdeas(false)} />
                      </div>
                      <div>
                         <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Kategori</label>
                         <select aria-label="Kategori" value={ideaCategory} onChange={(e) => setIdeaCategory(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-medium focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all appearance-none cursor-pointer">
                           <option value="Anatomi Tubuh">Anatomi Tubuh</option>
                           <option value="Tips & Gaya Hidup">Tips & Gaya Hidup</option>
                           <option value="Herbal & Tanaman">Herbal & Tanaman</option>
                           <option value="Buah & Nutrisi">Buah & Nutrisi</option>
                           <option value="Kesehatan Mental">Kesehatan Mental</option>
                           <option value="Penyakit & Gejala">Penyakit & Gejala</option>
                           <option value="Obesitas & Turun Berat Badan">Obesitas & Turun Berat Badan</option>
                           <option value="Fitness & Olahraga">Fitness & Olahraga</option>
                           <option value="Ibu & Bayi">Ibu & Bayi</option>
                           <option value="Lansia">Lansia</option>
                           <option value="Kulit & Kecantikan">Kulit & Kecantikan</option>
                           <option value="Imunitas & Daya Tahan">Imunitas & Daya Tahan</option>
                           <option value="Pencernaan & Diet">Pencernaan & Diet</option>
                           <option value="Jantung & Gula Darah">Jantung & Gula Darah</option>
                           <option value="Tekanan Darah & Kolesterol">Tekanan Darah & Kolesterol</option>
                           <option value="Tidur & Stres">Tidur & Stres</option>
                           <option value="Mitos vs Fakta Kesehatan">Mitos vs Fakta Kesehatan</option>
                           <option value="Nutrisi & Diet Harian">Nutrisi & Diet Harian</option>
                         </select>
                      </div>
                    </div>
                    
                    <button onClick={() => generateIdeas(false)} disabled={loadingIdeas || !ideaTopic} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/20 active:scale-95">
                      {loadingIdeas ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} Generate Ide Konten SEO
                    </button>
                    <ProgressBar progress={progress} loading={loadingIdeas} />
                  </div>
                </div>

                {ideas.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Hasil Riset Ide</h3>
                      <button 
                        onClick={() => generateIdeas(true)}
                        disabled={loadingIdeas}
                        className="flex items-center gap-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg border border-indigo-200 transition-all disabled:opacity-50"
                      >
                        {loadingIdeas ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Generate Ide Lainnya
                      </button>
                    </div>
                    <div className="grid gap-5">
                      {ideas.map((idea, idx) => (
                        <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm relative group anim-fade-in-up">
                          <button 
                            onClick={() => {
                              const updated = [...ideas];
                              updated.splice(idx, 1);
                              setIdeas(updated);
                            }}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Hapus Ide"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          
                          <div className="pr-10">
                            <h4 className="text-xl font-bold text-slate-900 mb-4 leading-tight">{idea.title}</h4>
                            
                            <div className="space-y-4 mb-6">
                              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
                                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1.5 flex items-center gap-1.5"><Zap className="w-3 h-3" /> Hook Pembuka</span>
                                <p className="text-sm text-slate-800 font-bold italic">"{idea.hook}"</p>
                              </div>
                              
                              <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Deskripsi Visual Kasar</span>
                                  <p className="text-sm text-slate-600 leading-relaxed font-medium">{idea.visual_idea}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1.5">Alasan Potensi Viral</span>
                                  <p className="text-sm text-slate-600 leading-relaxed font-medium">{idea.viral_reason}</p>
                                </div>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => { 
                                setOmniIdea(`Topik: ${idea.title}\nHook: ${idea.hook}\nVisual: ${idea.visual_idea}`); 
                                setActiveTab('omni_flash'); 
                              }} 
                              className="inline-flex items-center justify-center gap-2 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 px-6 py-3 rounded-xl transition-all shadow-md shadow-slate-900/20 active:scale-95"
                            >
                              Gunakan Ide Ini ke Omni Flash <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'omni_flash' && (
              <div className="space-y-6" data-feature="omni-flash-15s">
                <div className="workspace-panel bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                    <div>
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-100 text-xs font-bold mb-4"><Zap className="w-4 h-4" /> GOOGLE OMNI FLASH</div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Satu ide. 3â€“6 scene. Narasi + prompt siap copy.</h2>
                      <p className="text-sm font-medium text-slate-500 leading-relaxed">Pilih jumlah scene, lalu dapatkan narasi dan prompt video tiap scene. Copy hasilnya, buka ARKX Studio, dan generate videonya di sana memakai NexaBot.</p>
                    </div>
                    <div className="shrink-0 rounded-xl bg-indigo-50 border border-indigo-100 px-5 py-3 text-center">
                      <div className="text-3xl font-extrabold text-indigo-700">15<span className="text-sm ml-1">detik</span></div>
                      <div className="text-xs font-semibold text-indigo-500 mt-1">per scene Â· {omniSceneCount} scene</div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
                    <span><strong className="text-slate-800">Model:</strong> <code>NexaBot Â· Omni Flash 1.2</code></span>
                    <span><strong className="text-slate-800">API:</strong> Relay NexaBot (t2v)</span>
                    <span><strong className="text-slate-800">Output:</strong> MP4 Â· 720p Â· audio native</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
                    <div>
                      <label htmlFor="omni-style" className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Visual Style</label>
                      <select id="omni-style" value={globalPromptStyle} onChange={e => setGlobalPromptStyle(e.target.value)} disabled={loadingOmni || loadingOmniBatch || mergingBatch} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 cursor-pointer">
                        <option value="Microscopic 3D Pixar-style">Microscopic 3D Pixar-style</option>
                        <option value="TikSehat">TikSehat</option>
                        <option value="Sehat30Hari">Sehat30Hari</option>
                        <option value="SiKawanSehat">SiKawanSehat</option>
                         <option value="BodyTalk">BodyTalk</option>
                         <option value="Pixar 3D Cartoon">Pixar 3D Cartoon</option>
                         <option value="Claymorphism 3D">Claymorphism 3D</option>
                         <option value="2D Flat Illustration">2D Flat Illustration</option>
                         <option value="Whiteboard Animation">Whiteboard Animation</option>
                         <option value="Watercolor Storybook">Watercolor Storybook</option>
                         <option value="Isometric 3D">Isometric 3D</option>
                         <option value="Comic Book Bold">Comic Book Bold</option>
                         <option value="Anime Style">Anime Style</option>
                         <option value="Realistic 3D">Realistic 3D</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="omni-aspect" className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Format Video</label>
                      <select id="omni-aspect" value={omniAspectRatio} onChange={e => setOmniAspectRatio(e.target.value as '9:16' | '16:9')} disabled={loadingOmni || loadingOmniBatch || mergingBatch} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 cursor-pointer">
                        <option value="9:16">Vertikal 9:16 Â· Reels / Shorts</option>
                        <option value="16:9">Landscape 16:9 Â· YouTube</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label htmlFor="omni-hook" className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Hook Technique</label>
                    <select id="omni-hook" value={omniHookTechnique} onChange={e => setOmniHookTechnique(e.target.value)} disabled={loadingOmni || loadingOmniBatch || mergingBatch} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 cursor-pointer">
                      <option value="Curiosity Gap">Curiosity Gap</option>
                      <option value="Shock">Shock</option>
                      <option value="Fear">Fear</option>
                      <option value="Surprise">Surprise</option>
                      <option value="Mistake">Mistake</option>
                    </select>
                  </div>

                  <div className="mb-5">
                    <label htmlFor="omni-idea" className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Topik / Ide Utama</label>
                    <textarea id="omni-idea" value={omniIdea} onChange={e => setOmniIdea(e.target.value)} disabled={loadingOmni || loadingOmniBatch || mergingBatch} maxLength={3000} placeholder="Contoh: Sel darah merah lucu menjelaskan kenapa tubuh butuh cukup air, dengan visual mikroskopis di dalam pembuluh darahâ€¦" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 resize-y min-h-[100px]" />
                  </div>

                  <div className="mb-6">
                    <span className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Jumlah Scene (narasi + prompt)</span>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Jumlah scene video">
                      {[3, 4, 6].map(jumlah => {
                        const dipilih = omniSceneCount === jumlah;
                        return (
                          <button
                            key={jumlah}
                            type="button"
                            role="radio"
                            aria-checked={dipilih}
                            onClick={() => setOmniSceneCount(jumlah)}
                            disabled={loadingOmni || loadingOmniBatch || mergingBatch}
                            className={`rounded-xl border px-3 py-3 text-center transition-all disabled:opacity-60 ${dipilih ? 'border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300'}`}
                          >
                            <span className="block text-lg font-extrabold leading-none">{jumlah} Scene</span>
                            <span className={`mt-1 block text-[11px] font-bold ${dipilih ? 'text-indigo-500' : 'text-slate-400'}`}>{jumlah * 15} detik total</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">Pilihan ini menentukan jumlah narasi dan prompt â€” dan juga jumlah video bila kamu menekan tombol buat video setelah narasi jadi: {omniSceneCount} scene = {omniSceneCount} narasi + {omniSceneCount} prompt, masing-masing untuk klip 15 detik yang digabung otomatis jadi {omniSceneCount * 15} detik.</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-6" aria-label="Alur tiap scene 15 detik">
                    <div className="rounded-xl border border-rose-100 bg-rose-50 p-3"><p className="text-xs font-bold text-rose-600">0â€“4 detik</p><p className="text-sm font-bold text-slate-800 mt-1">Hook</p></div>
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-600">4â€“11 detik</p><p className="text-sm font-bold text-slate-800 mt-1">Penjelasan</p></div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">11â€“15 detik</p><p className="text-sm font-bold text-slate-800 mt-1">CTA</p></div>
                  </div>

                  <button onClick={generateOmniScenes} disabled={loadingScenes || loadingOmni || !omniIdea.trim()} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/20 active:scale-95">
                    {loadingScenes ? <Loader2 className="w-5 h-5 animate-spin" /> : <List className="w-5 h-5" />}
                    {loadingScenes ? `Menyusun ${omniSceneCount} sceneâ€¦` : `Buat Narasi & Prompt ${omniSceneCount} Scene`}
                  </button>
                  <button onClick={omniScenes.length > 0 ? generateOmniBatch : generateOmniFlash} disabled={loadingScenes || loadingOmni || loadingOmniBatch || mergingBatch || (omniScenes.length > 0 ? false : !omniIdea.trim())} className="w-full mt-3 py-3 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 font-bold rounded-xl flex items-center justify-center gap-2 transition-all">
                    {loadingOmniBatch || loadingOmni ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                    {loadingOmniBatch ? 'Membuat video per sceneâ€¦' : loadingOmni ? 'Membuat video di Googleâ€¦' : omniScenes.length > 0 ? `Buat Video ${omniScenes.length} Scene Â· ${omniScenes.length * 15} Detik â€” Gabung Otomatis` : 'Buat Video Omni Flash Â· 15 Detik'}
                  </button>
                  {omniScenes.length > 0 && (
                    <button onClick={generateOmniFlash} disabled={loadingScenes || loadingOmni || loadingOmniBatch || mergingBatch || !omniIdea.trim()} className="w-full mt-2 py-2 text-[11px] text-slate-500 hover:text-indigo-600 disabled:opacity-50 font-bold rounded-xl transition-colors">
                      Atau buat 1 video dari ide saja (15 detik Â· Rp 150)
                    </button>
                  )}
                  {aiCallInfo && (
                    <div role="status" aria-live="polite" className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed ${aiCallInfo.status === 'ok' ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                      {aiCallInfo.status === 'ok' ? (
                        <>Model Gemini: <strong>{aiCallInfo.model}</strong> Â· selesai dalam <strong>{(aiCallInfo.ms / 1000).toFixed(1)} detik</strong>{aiCallInfo.dicoba.length > 1 ? <> Â· cadangan dipakai: {aiCallInfo.dicoba.join(' â†’ ')}</> : null}</>
                      ) : (
                        <>Gagal. Model dicoba: <strong>{aiCallInfo.dicoba.join(' â†’ ')}</strong>. Pesan asli: <span className="font-mono break-words">{aiCallInfo.pesan || 'tidak ada pesan'}</span></>
                      )}
                    </div>
                  )}
                  {loadingOmni && <div role="status" aria-live="polite" className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800"><p className="font-bold flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{omniStatus}</p><p className="text-xs mt-2 leading-relaxed">Biarkan tab terbuka. Generasi bisa memerlukan beberapa menit; 15 detik adalah durasi hasil video. Tidak ada retry generasi otomatis.</p></div>}
                  {(loadingOmniBatch || mergingBatch) && <div role="status" aria-live="polite" className="mt-4 bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800"><p className="font-bold flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{omniBatchStatus || 'Memproses…'}</p><p className="text-xs mt-2 leading-relaxed">Generate berurutan per scene; tiap scene = 1 potongan saldo. Setelah semua jadi, video digabung otomatis via ffmpeg. Biarkan tab terbuka.</p></div>}
                  <div className="mt-4 text-xs text-slate-500 leading-relaxed space-y-2">
                    <p>Video dibuat lewat <strong>relay NexaBot</strong> dengan kunci server; biayanya dipotong dari saldo NexaBot Anda per video (gratis bila paket Unlimited / admin). Jika narasi scene sudah dibuat, tombol utama otomatis membuat 1 video per scene berurutan lalu menggabungkannya jadi satu video (N × 15 detik) via ffmpeg — gagal di satu scene tidak menggagalkan scene lain; saldo scene gagal dikembalikan otomatis. API key Gemini tidak perlu diisi — narasi &amp; prompt scene disusun lewat <button onClick={() => { loadAiStatus(); setAiSettingsOpen(true); }} className="text-indigo-600 font-bold hover:text-indigo-800">relay server</button> dengan kunci milik admin (kuota harian per member).</p>
                    <p>Setiap pembuatan video meminta konfirmasi dan memotong saldo satu kali; bila gagal, saldo dikembalikan otomatis. Hasil disimpan permanen di server. <a href="https://nexabot.id/api-docs" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-bold hover:text-indigo-800">Dokumentasi NexaBot â†—</a></p>
                  </div>
                </div>

                {loadingScenes && <div role="status" aria-live="polite" className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800"><p className="font-bold flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Menyusun narasi dan prompt {omniSceneCount} sceneâ€¦ <span className="font-semibold text-indigo-600">{omniStatus}</span></p><p className="text-xs mt-2 leading-relaxed">Hanya narasi dan prompt yang dibuat di sini; setelah jadi, tekan tombol video di atas — setiap scene dibuat jadi 1 video (15 detik, NexaBot) lalu digabung otomatis jadi satu video (N × 15 detik) via ffmpeg.</p></div>}

                {omniScenes.length > 0 && <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm anim-fade-in-up" aria-label="Narasi dan prompt per scene">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Check className="w-5 h-5 text-emerald-600" /> {omniScenes.length} scene siap dicopy</h3>
                      <p className="text-xs text-slate-500 mt-1">Copy narasi &amp; prompt, lalu generate videonya di ARKX Studio dengan NexaBot.</p>
                    </div>
                    <CopyButton
                      text={omniScenes.map(s2 => `Scene ${s2.scene} (${s2.role} Â· 15 detik)\nNarasi: ${s2.voiceover}\nVisual: ${s2.visual}\nVideo Prompt: ${s2.video_prompt}`).join('\n\n---\n\n')}
                      label="Copy Semua Scene"
                      className="inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm"
                    />
                  </div>
                  <div className="grid gap-4">
                    {omniScenes.map(scene => (
                      <div key={scene.scene} className="rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">Scene {scene.scene}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-0.5">{scene.role}</span>
                            <span className="text-xs text-slate-500">15 detik</span>
                          </div>
                          <CopyButton
                            text={`Scene ${scene.scene} (${scene.role} Â· 15 detik)\nNarasi: ${scene.voiceover}\nVisual: ${scene.visual}\nVideo Prompt: ${scene.video_prompt}`}
                            label={`Copy Scene ${scene.scene}`}
                            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl"
                          />
                        </div>
                        <div className="p-4 grid gap-3">
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Narasi / Voiceover</span>
                            <p className="text-sm text-slate-800 leading-relaxed">{scene.voiceover}</p>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Visual</span>
                            <p className="text-xs text-slate-600 leading-relaxed">{scene.visual}</p>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Prompt Video (EN)</span>
                            <p className="text-xs text-emerald-700 font-mono bg-emerald-50 p-3 rounded-xl border border-emerald-100 leading-relaxed">{scene.video_prompt}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>}
                {omniBatch.length > 0 && <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm anim-fade-in-up" aria-label="Video per scene dan hasil gabungan">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Video className="w-5 h-5 text-indigo-600" /> Video {omniBatch.length} scene → 1 video</h3>
                      <p className="text-xs text-slate-500 mt-1">{omniBatch.length} scene · {omniBatch.length * 15} detik bila digabung · 1 video = 1 potongan saldo NexaBot · gagal = otomatis kembali.</p>
                    </div>
                  </div>
                  <div className="grid gap-2 mb-4">
                    {omniBatch.map((b, i) => (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 bg-slate-50">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          {b.status === 'done' && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                          {b.status === 'running' && <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />}
                          {b.status === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                          {b.status === 'idle' && <span className="w-4 h-4 inline-block rounded-full border border-slate-300 shrink-0" />}
                          <span className="text-sm font-bold text-slate-900">Scene {b.scene}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-0.5">{b.role}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {b.status === 'error'
                            ? <p className="text-xs text-rose-600 break-words">{b.error}</p>
                            : <p className="text-xs text-slate-500 truncate">{b.status === 'done' ? `Job ${b.jobId || ''} · selesai` : b.status === 'running' ? 'Sedang dibuat NexaBot…' : 'Menunggu giliran…'}</p>}
                        </div>
                        {b.status === 'done' && b.url && <a href={b.url} download={`arkx-health-scene-${b.scene}.mp4`} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 shrink-0">Unduh MP4</a>}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {omniBatch.some(b => b.status === 'error') && (
                      <button onClick={retryFailedScenes} disabled={loadingOmniBatch || mergingBatch} className="inline-flex items-center gap-2 px-4 py-2.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-700 text-xs font-bold rounded-xl transition-colors">
                        <Loader2 className={`w-4 h-4 ${loadingOmniBatch ? 'animate-spin' : 'hidden'}`} /> Ulangi Scene Gagal ({omniBatch.filter(b => b.status === 'error').length})
                      </button>
                    )}
                    <button
                      onClick={() => mergeBatchVideos(omniBatch.filter(b => b.status === 'done' && b.url).map(b => b.url as string))}
                      disabled={loadingOmniBatch || mergingBatch || omniBatch.filter(b => b.status === 'done' && b.url).length < 2}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                    >
                      {mergingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                      Gabungkan {omniBatch.filter(b => b.status === 'done' && b.url).length} Scene Jadi 1 Video ({omniBatch.filter(b => b.status === 'done' && b.url).length * 15} dtk)
                    </button>
                  </div>
                  {omniMerged && (
                    <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                        <p className="text-sm font-bold text-emerald-800"><Check className="w-4 h-4 inline mr-1" />Gabungan {omniMerged.scenes} scene siap — {omniMerged.scenes * 15} detik</p>
                        <a href={omniMerged.url} download={`arkx-health-anim-${omniMerged.scenes}-scene-${omniMerged.scenes * 15}detik.mp4`} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"><Video className="w-4 h-4" /> Unduh MP4</a>
                      </div>
                      <div className="rounded-xl overflow-hidden bg-slate-900 border border-emerald-100 flex justify-center"><video src={omniMerged.url} controls playsInline preload="metadata" aria-label="Video gabungan semua scene" className="w-full max-h-[480px]" /></div>
                      <p className="text-[11px] text-emerald-800/80 mt-2">Hasil gabungan tersimpan sementara di memori browser — unduh sebelum menutup tab.</p>
                    </div>
                  )}
                </section>}

                {omniVideo && <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm anim-fade-in-up" aria-label="Hasil video Omni Flash">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
                    <div><h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Check className="w-5 h-5 text-emerald-600" /> Video Omni Flash siap</h3><p className="text-xs text-slate-500 mt-1">15 detik Â· {omniVideo.aspectRatio} Â· MP4 Â· 720p</p></div>
                    <a href={omniVideo.url} download="arkx-omni-flash-15-detik.mp4" className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-5 py-3 rounded-xl"><Video className="w-4 h-4" /> Unduh MP4</a>
                  </div>
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-slate-200 flex justify-center"><video src={omniVideo.url} controls playsInline preload="metadata" aria-label="Video Omni Flash 15 detik" className="w-full max-h-[560px]" /></div>
                  <p className="text-xs text-slate-500 mt-4 leading-relaxed">Unduh sebelum menutup tab atau membuat video baru. Hasil sementara berada di memori browser, bukan galeri publik.</p>
                  {omniVideo.interactionId && <p className="text-xs text-slate-400 mt-2 break-all">Job ID NexaBot: {omniVideo.interactionId}</p>}
                </section>}

                {omniConfirmOpen && <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget) setOmniConfirmOpen(false); }}>
                  <section role="dialog" aria-modal="true" aria-labelledby="omni-confirm-title" aria-describedby="omni-confirm-note" className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 sm:p-8 anim-zoom-in max-h-[90vh] overflow-y-auto">
                    <div className="flex items-start justify-between gap-4 mb-4"><h3 id="omni-confirm-title" className="text-xl font-bold text-slate-900">Konfirmasi generasi video</h3><button onClick={() => setOmniConfirmOpen(false)} aria-label="Tutup konfirmasi" className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button></div>
                    <p id="omni-confirm-note" className="text-sm text-slate-600 leading-relaxed mb-5">{omniConfirmMode === 'batch'
                      ? <>Anda akan membuat <strong>{omniScenes.length} video (1 video per scene, masing-masing 15 detik)</strong> lewat NexaBot, lalu menggabungkannya otomatis jadi <strong>satu video {omniScenes.length * 15} detik</strong> via ffmpeg. Biaya dipotong dari <strong>saldo NexaBot</strong> Anda <strong>per video</strong> (gratis bila paket Unlimited / admin) dan dikembalikan otomatis untuk scene yang gagal.</>
                      : <>Anda akan membuat <strong>satu video 15 detik</strong> lewat NexaBot. Biaya dipotong dari <strong>saldo NexaBot</strong> Anda (gratis bila paket Unlimited aktif) dan dikembalikan otomatis bila gagal.</>}
                    </p>
                    <dl className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm mb-5"><div className="flex justify-between gap-3"><dt className="text-slate-500">Model</dt><dd className="font-bold text-slate-800 text-xs">NexaBot Â· Omni Flash 1.2</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Output</dt><dd className="font-bold text-slate-800">{omniConfirmMode === 'batch' ? `${omniScenes.length} video · ${omniScenes.length * 15} detik (digabung jadi 1)` : '1 video · 15 detik'}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Format</dt><dd className="font-bold text-slate-800">{omniAspectRatio} Â· 720p</dd></div></dl>
                    <p className="text-xs text-slate-500 leading-relaxed mb-6">Topik dikirim ke NexaBot memakai kunci server. Tidak ada permintaan sebelum Anda menekan tombol lanjut di bawah, dan submit tidak diulang otomatis setelah job terbentuk.</p>
                    <div className="flex flex-col sm:flex-row gap-3"><button onClick={() => setOmniConfirmOpen(false)} className="px-4 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-bold">Batal</button><button onClick={() => omniConfirmMode === 'batch' ? confirmOmniBatch() : confirmOmniFlash()} className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">{omniConfirmMode === 'batch' ? `Lanjutkan · Buat ${omniScenes.length} Scene` : 'Lanjutkan · Buat 15 Detik'}</button></div>
                  </section>
                </div>}
              </div>
            )}

            {activeTab === 'affiliate' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Animasi Affiliate</h2>
                  <p className="text-sm font-medium text-slate-500 mb-8">Upload foto produk dan deskripsi, AI akan membuatkan ide konten affiliate yang menarik dan aman dari overclaim.</p>
                  
                  <div className="space-y-6">
                    <div className="relative border-2 border-dashed border-slate-300 rounded-2xl p-8 flex flex-col items-center justify-center transition-colors hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/50">
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={(e) => setAffiliateProductPhoto(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="flex flex-col items-center gap-3">
                        {affiliateProductPhoto ? (
                          <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-slate-200 shadow-md">
                            <img 
                              src={URL.createObjectURL(affiliateProductPhoto)} 
                              alt="Preview" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                              <p className="text-[10px] text-white font-bold uppercase tracking-wider">Ganti Foto</p>
                            </div>
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400">
                            <ImageIcon className="w-8 h-8" />
                          </div>
                        )}
                        <div className="text-center">
                          <p className="text-sm font-bold text-slate-700">{affiliateProductPhoto ? affiliateProductPhoto.name : 'Klik atau drag foto produk ke sini'}</p>
                          <p className="text-xs font-medium text-slate-500 mt-1">Format: JPG, PNG, WEBP (Maks 10MB)</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Deskripsi Produk (Optional)</label>
                        <textarea 
                          value={affiliateProductDesc}
                          onChange={(e) => setAffiliateProductDesc(e.target.value)}
                          placeholder="Contoh: Sepatu lari ringan dengan teknologi cushion terbaru..."
                          className="w-full bg-white border border-slate-200 rounded-xl p-4 text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 min-h-[120px] resize-none transition-all"
                        />
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm h-[70px] flex items-center">
                        <label className="flex items-center gap-3 cursor-pointer w-full">
                          <div className="relative shrink-0">
                            <input type="checkbox" className="sr-only" checked={affiliateNoOverclaim} onChange={(e) => setAffiliateNoOverclaim(e.target.checked)} />
                            <div className={`block w-12 h-7 rounded-full transition-colors shadow-inner ${affiliateNoOverclaim ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                            <div className={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform shadow-sm ${affiliateNoOverclaim ? 'transform translate-x-5' : ''}`}></div>
                          </div>
                          <div className="overflow-hidden">
                            <span className="text-sm font-bold text-emerald-900 block truncate">Filter Anti Overclaim</span>
                            <span className="text-xs font-medium text-emerald-700 truncate block">Wajib Aktif untuk TikTok</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button 
                        onClick={() => generateAffiliateIdeas(false)} 
                        disabled={loadingAffiliateIdeas || (!affiliateProductDesc && !affiliateProductPhoto)} 
                        className="flex-1 py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/20 active:scale-95"
                      >
                        {loadingAffiliateIdeas ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />} 
                        {loadingAffiliateIdeas ? 'Menganalisa...' : 'Generate Ide Affiliate'}
                      </button>
                      
                      {(loadingAffiliateIdeas || affiliateIdeas.length > 0) && (
                        <button 
                          onClick={() => {
                            setAffiliateIdeas([]);
                            setAffiliateScript([]);
                            setAffiliateProductPhoto(null);
                            setAffiliateProductDesc('');
                            setAppError('');
                            setProgress(0);
                            setLoadingAffiliateIdeas(false);
                            if (progressInterval.current) clearInterval(progressInterval.current);
                          }}
                          className="px-5 py-4 bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-500 rounded-xl transition-all shadow-sm"
                          title="Reset Semua"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <ProgressBar progress={progress} loading={loadingAffiliateIdeas} />
                </div>

                {affiliateIdeas.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Ide Konten Affiliate</h3>
                      <button 
                        onClick={() => generateAffiliateIdeas(true)}
                        disabled={loadingAffiliateIdeas}
                        className="flex items-center gap-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg border border-indigo-200 transition-all disabled:opacity-50"
                      >
                        {loadingAffiliateIdeas ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Generate Ide Lainnya
                      </button>
                    </div>
                    <div className="grid gap-5">
                      {affiliateIdeas.map((idea, idx) => (
                        <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm relative group anim-fade-in-up">
                          <button 
                            onClick={() => {
                              const updated = [...affiliateIdeas];
                              updated.splice(idx, 1);
                              setAffiliateIdeas(updated);
                            }}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Hapus Ide"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="pr-10 mb-5">
                            <h4 className="text-lg font-bold text-slate-900 mb-2">{idea.title}</h4>
                            <p className="text-slate-600 font-medium text-sm leading-relaxed">{idea.description}</p>
                          </div>
                          <button 
                            onClick={() => generateAffiliateScript(idea)}
                            disabled={loadingAffiliateScript}
                            className="inline-flex items-center gap-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 rounded-xl shadow-md shadow-indigo-600/20 transition-all active:scale-95"
                          >
                            {loadingAffiliateScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Gunakan Ide & Buat Naskah
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {affiliateScript.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                      <h2 className="text-xl font-bold text-slate-900">Naskah Affiliate (Bisa Diedit)</h2>
                      <button 
                        onClick={resetAffiliate}
                        className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-4 py-2.5 rounded-xl transition-all shadow-sm border border-rose-200 flex items-center gap-2 active:scale-95"
                      >
                        <Plus className="w-4 h-4" /> Buat Animasi Baru
                      </button>
                    </div>
                    
                    <div className="space-y-6">
                      {affiliateScript.map((scene, index) => (
                        <div key={index} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
                          <div className="mb-4">
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-3 py-1 rounded-full border border-indigo-200 uppercase tracking-widest">
                              Scene {scene.scene}
                            </span>
                          </div>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Visual</label>
                              <textarea 
                                value={scene.visual}
                                onChange={(e) => {
                                  const updated = [...affiliateScript];
                                  updated[index].visual = e.target.value;
                                  setAffiliateScript(updated);
                                }}
                                className="w-full bg-white border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 min-h-[100px] resize-none shadow-sm"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-slate-500 ml-1 uppercase tracking-wider">Voice Over</label>
                              <textarea 
                                value={scene.voiceover}
                                onChange={(e) => {
                                  const updated = [...affiliateScript];
                                  updated[index].voiceover = e.target.value;
                                  setAffiliateScript(updated);
                                }}
                                className="w-full bg-white border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 min-h-[100px] resize-none shadow-sm"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 mt-8">
                      <button 
                        onClick={generateAffiliatePrompts}
                        disabled={loadingPrompts}
                        className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl transition-all shadow-md shadow-slate-900/20 active:scale-95"
                      >
                        {loadingPrompts ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                        Generate Prompt
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'analyze' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">Analisa Konten Video</h2>
                  <p className="text-sm font-medium text-slate-500 mb-6">Upload video referensi, AI akan membedah setiap scene menjadi Prompt Video, Deskripsi Background, dan Voiceover yang bisa Anda edit atau jadikan ulang di Omni Flash.</p>
                  
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
                    <h3 className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Cara Penggunaan Fitur Ini:</h3>
                    <ol className="list-decimal list-inside text-xs font-medium text-amber-700 space-y-1.5 ml-1">
                      <li>Upload video referensi yang ingin dianalisa (format MP4/WebM, maksimal 10MB).</li>
                      <li>Klik <strong>Mulai Analisa Video</strong> dan tunggu AI memproses setiap scene.</li>
                      <li>Setelah hasil keluar, Anda bisa <strong>Copy Scene Ini</strong> untuk disimpan.</li>
                      <li>Gunakan tombol <strong>Gunakan di Omni Flash</strong> untuk memproses ulang naskah tersebut menjadi video 3D animasi baru.</li>
                    </ol>
                  </div>
                  
                  <div className="space-y-6">
                    <div className="relative border-2 border-dashed border-slate-300 rounded-2xl p-8 flex flex-col items-center justify-center transition-colors hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/50">
                      <input 
                        type="file" 
                        accept="video/*" 
                        onChange={(e) => setAnalysisVideo(e.target.files?.[0] || null)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400">
                          <Upload className="w-8 h-8" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-bold text-slate-700">{analysisVideo ? analysisVideo.name : 'Klik atau drag video ke sini'}</p>
                          <p className="text-xs font-medium text-slate-500 mt-1">Format: MP4, WebM (Maksimal 10MB disarankan)</p>
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={generateAnalysis} 
                      disabled={loadingAnalysis || !analysisVideo} 
                      className="w-full py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-slate-900/20 active:scale-95"
                    >
                      {loadingAnalysis ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanSearch className="w-5 h-5" />} Mulai Analisa Video
                    </button>
                  </div>
                  <ProgressBar progress={progress} loading={loadingAnalysis} />
                </div>

                {analysisResult.length > 0 && (
                  <div className="space-y-4 anim-fade-in-up">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-2 gap-3">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Hasil Analisa Scene</h3>
                      <div className="flex flex-wrap gap-2 items-center">
                        <select 
                          value={globalPromptStyle} 
                          onChange={(e) => setGlobalPromptStyle(e.target.value)} 
                          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm appearance-none"
                          title="Pilih Visual Style"
                        >
                          <option value="Microscopic 3D Pixar-style">Microscopic 3D Pixar-style</option>
                          <option value="TikSehat">TikSehat</option>
                          <option value="Sehat30Hari">Sehat30Hari</option>
                          <option value="SiKawanSehat">SiKawanSehat</option>
                         <option value="BodyTalk">BodyTalk</option>
                         <option value="Pixar 3D Cartoon">Pixar 3D Cartoon</option>
                         <option value="Claymorphism 3D">Claymorphism 3D</option>
                         <option value="2D Flat Illustration">2D Flat Illustration</option>
                         <option value="Whiteboard Animation">Whiteboard Animation</option>
                         <option value="Watercolor Storybook">Watercolor Storybook</option>
                         <option value="Isometric 3D">Isometric 3D</option>
                         <option value="Comic Book Bold">Comic Book Bold</option>
                         <option value="Anime Style">Anime Style</option>
                         <option value="Realistic 3D">Realistic 3D</option>
                        </select>
                        <button 
                          onClick={() => {
                            const scriptText = analysisResult.map(s => `Scene ${s.scene_number}:\nVisual: ${s.background_description}\nPrompt: ${s.video_prompt}\nVoiceover: ${s.text_content}`).join('\n\n');
                            setOmniIdea(scriptText); 
                            setActiveTab('omni_flash');
                          }}
                          className="text-xs font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition-colors shadow-sm border border-indigo-200"
                        >
                          Gunakan di Omni Flash
                        </button>
                        <button 
                          onClick={resetAnalysis}
                          className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-4 py-2 rounded-lg transition-colors shadow-sm border border-rose-200"
                        >
                          Analisa Baru
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid gap-4">
                      {analysisResult.map((scene, idx) => (
                        <div key={idx} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 gap-3">
                            <span className="font-bold text-sm text-slate-800 shrink-0">Scene {scene.scene_number}</span>
                            <CopyButton 
                              text={`Prompt: ${scene.video_prompt}\nBackground: ${scene.background_description}\nText: ${scene.text_content}`} 
                              label="Copy Scene Ini"
                              className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-white hover:bg-slate-100 text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold transition-all border border-slate-200 active:scale-95 shadow-sm"
                            />
                          </div>
                          <div className="p-5 space-y-4">
                            <div>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Video Prompt</span>
                              <p className="text-sm text-indigo-700 font-mono bg-indigo-50 p-3 rounded-xl border border-indigo-100">{scene.video_prompt}</p>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-4">
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Background</span>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                                  <p className="text-xs font-medium text-slate-600 leading-relaxed">{scene.background_description}</p>
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Text / Voiceover</span>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                                  <p className="text-xs text-slate-800 font-medium italic">"{scene.text_content}"</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 relative overflow-hidden shadow-sm">
                <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                  <ImageIcon className="w-40 h-40 text-indigo-900" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-slate-900">Video Prompt Viewer</h2>
                    {prompts.length > 0 && (
                       <button 
                         onClick={() => setPrompts([])}
                         className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
                       >
                         <Trash2 className="w-3.5 h-3.5" /> Bersihkan Prompt
                       </button>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-500 mb-6">Tab ini digunakan untuk melihat dan menyalin prompt yang telah di-generate dari fitur lain.</p>
                  
                  {prompts.some(p => p.holding_product) && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 shadow-sm">
                      <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-1">
                        <AlertCircle className="w-4 h-4" /> Instruksi Khusus AI Generator
                      </h4>
                      <p className="text-xs font-medium text-amber-700 leading-relaxed ml-6">
                        Terdapat tag <strong>[Pegang Produk]</strong> pada beberapa scene di bawah. Ini berarti saat Anda memasukkan "Image Prompt" ke AI Image Generator (seperti Midjourney atau fitur referensi gambar di AI lain), Anda <strong>DIWAJIBKAN untuk meng-upload / memasukkan Foto Produk</strong> asli Anda sebagai referensi (image-to-image prompt) agar AI bisa menyatukan produk ke tangan karakter 3D.
                      </p>
                    </div>
                  )}

                  {prompts.length > 0 ? (
                    <div className="space-y-6">
                      <div className="flex justify-end px-2">
                        <CopyButton 
                          text={prompts.map(p => `Scene ${p.scene} (${p.duration_seconds}s):\n${p.image_prompt ? `Image Prompt:\n${p.image_prompt}\n\n` : ''}${p.video_prompt ? `Video Prompt:\n${p.video_prompt}\n\n` : ''}Voiceover:\n${p.voiceover}`).join('\n\n---\n\n')} 
                          label="Copy Semua Scene"
                          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm"
                        />
                      </div>
                      
                      <div className="grid gap-6">
                        {prompts.map((p, idx) => (
                          <div key={idx} className="bg-white border border-slate-200 rounded-2xl overflow-hidden anim-fade-in-up shadow-sm">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 gap-3">
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-sm text-slate-800 shrink-0">Scene {p.scene} ({p.duration_seconds}s)</span>
                                {p.holding_product && (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded border border-amber-200 uppercase tracking-wider shrink-0 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3"/> Pegang Produk
                                  </span>
                                )}
                              </div>
                              <div className="flex w-full sm:w-auto gap-2">
                                {p.image_prompt && (
                                  <CopyButton 
                                    text={p.image_prompt} 
                                    label="Copy Image Prompt"
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-white hover:bg-slate-100 text-indigo-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-slate-200 shadow-sm"
                                  />
                                )}
                                {p.video_prompt && (
                                  <CopyButton 
                                    text={`${p.video_prompt}\n\nVoiceover:\n"${p.voiceover}"`} 
                                    label="Copy Video Prompt"
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-white hover:bg-slate-100 text-emerald-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-slate-200 shadow-sm"
                                  />
                                )}
                              </div>
                            </div>
                            
                            <div className="p-5">
                              <div className="grid md:grid-cols-2 gap-5">
                                {/* Kolom Kiri: Image Prompt */}
                                {p.image_prompt && (
                                  <div className="flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 p-4">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3 flex items-center gap-1.5">
                                      <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                                      Image Prompt
                                    </span>
                                    <p className="text-sm text-indigo-800 font-mono leading-relaxed flex-1">{p.image_prompt}</p>
                                  </div>
                                )}

                                {/* Kolom Kanan: Video Prompt & Voiceover */}
                                <div className="flex flex-col h-full space-y-4">
                                  {p.video_prompt && (
                                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex-1">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3 flex items-center gap-1.5">
                                        <ImagePlay className="w-3.5 h-3.5 text-emerald-500" />
                                        Video Prompt (Gunakan Gambar Hasil Generate)
                                      </span>
                                      <p className="text-sm text-slate-700 font-mono leading-relaxed">{p.video_prompt}</p>
                                    </div>
                                  )}
                                  
                                  {/* Voiceover nempel di bawah Video Prompt */}
                                  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-start gap-3">
                                    <PlayCircle className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Voiceover</span>
                                      <p className="text-sm text-slate-800 font-medium italic leading-relaxed">"{p.voiceover}"</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                      <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-bold text-slate-500">Belum ada prompt yang dihasilkan.</p>
                      <p className="text-xs font-medium text-slate-400 mt-1">Gunakan fitur Animasi Affiliate atau Naskah Custom terlebih dahulu.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
      </main>
    </div>

      {aiSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget) setAiSettingsOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 sm:p-8 anim-zoom-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 mb-3"><h2 id="ai-settings-title" className="text-xl font-bold text-slate-900 flex items-center gap-2"><KeyRound className="w-5 h-5 text-indigo-600" /> Pengaturan AI</h2><button onClick={() => setAiSettingsOpen(false)} aria-label="Tutup pengaturan AI" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button></div>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">Narasi &amp; prompt scene dibuat lewat relay <code>/api/public/studio-ai</code> dengan kunci Gemini milik server — member tidak perlu (dan tidak bisa) menyimpan key sendiri. Refresh / login ulang tidak akan meminta isi key lagi.</p>
            {aiServer.loading ? (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 text-center">Memeriksa status kunci server…</div>
            ) : aiServer.configured ? (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 leading-relaxed">✅ <b>Kunci Gemini server AKTIF</b>{aiDailyCap != null && <> — batas <b>{aiDailyCap} panggilan/hari</b> per member</>}{aiUsed != null && <> (hari ini kamu terpakai <b>{aiUsed}{aiDailyCap != null ? `/${aiDailyCap}` : ''}</b>)</>}. Fitur generasi siap dipakai.</div>
            ) : aiServer.configured === false ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">⚠️ <b>Kunci Gemini server BELUM diisi.</b> {pengaturanDikunci ? <>Minta admin menambahkan <code>"studio_gemini_key"</code> di <b>System Settings → AI Studio (Gemini)</b>.</> : <>Isi di <b>System Settings → AI Studio (Gemini)</b> supaya fitur generasi aktif untuk semua member Pro / Unlimited.</>}</div>
            ) : (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 leading-relaxed">Tidak bisa menghubungi server untuk memeriksa status kunci. Coba muat ulang halaman.</div>
            )}
            {!pengaturanDikunci && <p className="-mt-2 mb-4 text-[11px] text-slate-400 leading-relaxed">Kunci Gemini dikelola di <b>Admin → System Settings → AI Studio (Gemini)</b> — bukan di halaman ini. Halaman ini hanya memilih model.</p>}
            <form onSubmit={saveAiModel} className="space-y-4">
              <div><label htmlFor="gemini-model" className="block text-sm font-bold text-slate-700 mb-2">Model Gemini</label><input id="gemini-model" type="text" value={aiModel} onChange={e => setAiModel(e.target.value)} disabled={pengaturanDikunci} placeholder="gemini-3.1-flash-lite" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed" />{pengaturanDikunci && <p className="text-xs text-amber-700 mt-2 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Model dikunci oleh admin: member tidak bisa mengubahnya.</p>}</div>
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 text-xs text-indigo-800 leading-relaxed">Prompt dan file yang Anda proses dikirim lewat relay server ke Google Gemini (kunci milik server, kuota dihitung per member per hari). Video dibuat oleh NexaBot memakai saldo NexaBot Anda.</div>
              <div className="flex flex-wrap gap-3 pt-2"><button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">Simpan model</button><button type="button" onClick={() => setAiSettingsOpen(false)} className="px-4 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-semibold">Tutup</button></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
};

export default function App() {
  return <><CustomStyles /><HealthAnimTool /></>;
}
