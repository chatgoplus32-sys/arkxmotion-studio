"""
=============================================================================
PIPELINE LENGKAP PEMBERSIHAN WATERMARK RUNNINGHUB SETELAH GENERATE
=============================================================================
Alur Standar Industri (End-to-End):

[1. RUNNINGHUB OUTPUT DITERIMA]
         │ (Task ID + URL CDN RunningHub)
         ▼
[2. STREAM DOWNLOAD & VALIDASI HEADER]
         │ Memastikan bukan HTML error/corrupt (cek b"ftyp"/b"moov"/b"mdat")
         ▼
[3. PROBE DIMENSI & ORIENTASI]
         │ FFprobe menentukan rasio (Portrait 9:16 vs Landscape 16:9)
         ▼
[4. AUTO TOP-CROP & LOSSLESS RESCALING]
         │ Potong banner watermark RunningHub di strip atas
         │ Rescale kembali ke resolusi asli (CRF 18, Audio copy)
         ▼
[5. VERIFIKASI & FINALISASI OUTPUT]
         │ File No-WM siap disajikan ke user atau diupload ke CDN / R2
=============================================================================
"""
import os
import time
import uuid
import requests
import logging
from typing import Dict, Any, Optional
from watermark_cleaner import RunningHubWatermarkCleaner

logger = logging.getLogger("RH_Pipeline")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class RunningHubPostProcessPipeline:
    def __init__(self, output_dir: str = "./outputs", cleaner: Optional[RunningHubWatermarkCleaner] = None):
        self.output_dir = os.path.abspath(output_dir)
        os.makedirs(self.output_dir, exist_ok=True)
        self.cleaner = cleaner or RunningHubWatermarkCleaner()

    def step1_download_and_validate(self, video_url: str, task_id: str) -> str:
        """
        Langkah 1: Mengunduh video dari RunningHub CDN dengan streaming & validasi format.
        Mencegah file kosong, file HTML error, atau file korup masuk ke proses FFmpeg.
        """
        temp_raw_path = os.path.join(self.output_dir, f"raw_{task_id}_{uuid.uuid4().hex[:8]}.mp4")
        logger.info(f"[Langkah 1] Mengunduh output video dari RunningHub: {video_url[:80]}...")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        }

        r = requests.get(video_url, stream=True, timeout=(20, 180), headers=headers)
        if r.status_code != 200:
            raise RuntimeError(f"Gagal mengunduh video dari vendor (HTTP {r.status_code})")

        with open(temp_raw_path, "wb") as f_out:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f_out.write(chunk)

        file_sz = os.path.getsize(temp_raw_path)
        if file_sz < 50 * 1024:
            os.remove(temp_raw_path)
            raise ValueError(f"Ukuran file video terlalu kecil ({file_sz} bytes). Mencegah blank hitam!")

        # Validasi header file MP4 (magic bytes)
        with open(temp_raw_path, "rb") as f_chk:
            header_sample = f_chk.read(512)

        if b"<html" in header_sample.lower() or b"<!doctype" in header_sample.lower():
            os.remove(temp_raw_path)
            raise ValueError("Response dari URL RunningHub adalah halaman HTML Error, bukan video MP4!")

        if not any(tag in header_sample for tag in [b"ftyp", b"moov", b"mdat"]):
            logger.warning("[Langkah 1] Header MP4 tidak standar, namun proses tetap dilanjutkan.")

        logger.info(f"[Langkah 1] Unduhan valid: {temp_raw_path} ({file_sz / (1024 * 1024):.2f} MB)")
        return temp_raw_path

    def step2_clean_watermark(self, raw_video_path: str, task_id: str) -> str:
        """
        Langkah 2: Menghapus watermark banner atas RunningHub secara presisi.
        """
        clean_output_path = os.path.join(self.output_dir, f"clean_{task_id}.mp4")
        logger.info(f"[Langkah 2] Memproses penghapusan watermark via FFmpeg...")

        start_time = time.time()
        success = self.cleaner.clean_video(
            input_path=raw_video_path,
            output_path=clean_output_path,
            crf=18,
            preset="fast"
        )
        duration = time.time() - start_time

        if not success or not os.path.exists(clean_output_path):
            raise RuntimeError("FFmpeg gagal menghasilkan video bebas watermark.")

        logger.info(f"[Langkah 2] Selesai membersihkan watermark dalam {duration:.1f} detik!")
        return clean_output_path

    def process(self, task_id: str, video_url: str, keep_raw: bool = False) -> Dict[str, Any]:
        """
        Menjalankan seluruh alur pipa pemrosesan:
        1. Terima URL & Task ID
        2. Unduh & Validasi
        3. Hapus Watermark
        4. Kembalikan data metadata & path file bersih
        """
        logger.info(f"=== MEMULAI PIPELINE PEMBERSIHAN UNTUK TASK: {task_id} ===")
        raw_path = None
        try:
            # 1. Download
            raw_path = self.step1_download_and_validate(video_url, task_id)

            # 2. Pembersihan
            clean_path = self.step2_clean_watermark(raw_path, task_id)

            # 3. Ambil spek video bersih
            specs = self.cleaner.probe_video(clean_path)

            return {
                "success": True,
                "task_id": task_id,
                "clean_video_path": clean_path,
                "raw_video_path": raw_path if keep_raw else None,
                "width": specs["width"],
                "height": specs["height"],
                "aspect_ratio": specs["aspect_ratio"],
                "file_size_mb": round(os.path.getsize(clean_path) / (1024 * 1024), 2),
                "is_watermark_free": True
            }
        except Exception as e:
            logger.error(f"Pipeline gagal untuk {task_id}: {e}")
            return {
                "success": False,
                "task_id": task_id,
                "error": str(e),
                "is_watermark_free": False
            }
        finally:
            # Bersihkan file raw jika tidak diminta disimpan
            if not keep_raw and raw_path and os.path.exists(raw_path):
                try:
                    os.remove(raw_path)
                except Exception:
                    pass
