"""
=============================================================================
MODUL PEMBERSIH WATERMARK RUNNINGHUB AI (FFMPEG AUTO TOP-CROP & RESCALE)
=============================================================================
Metode:
Watermark RunningHub AI diletakkan di strip paling atas video secara statis.
Modul ini:
1. Menganalisis orientasi (Portrait vs Landscape) & dimensi video via FFprobe.
2. Menghitung tinggi crop atas secara dinamis (58px / 46px / 38px / 32px).
3. Mengeksekusi filter FFmpeg crop & scale kembali ke resolusi asli.
4. Menghasilkan video 100% jernih tanpa noda blur/buram.
=============================================================================
"""
import os
import shutil
import logging
import subprocess
import tempfile
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger("RH_WatermarkCleaner")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class RunningHubWatermarkCleaner:
    def __init__(self, ffmpeg_path: Optional[str] = None, ffprobe_path: Optional[str] = None):
        """
        Inisialisasi cleaner dengan auto-detect lokasi ffmpeg & ffprobe.
        Mendukung Windows maupun Linux / macOS.
        """
        self.ffmpeg = ffmpeg_path or shutil.which("ffmpeg") or (
            r"C:\ffmpeg\bin\ffmpeg.exe" if os.path.exists(r"C:\ffmpeg\bin\ffmpeg.exe") else "ffmpeg"
        )
        self.ffprobe = ffprobe_path or shutil.which("ffprobe") or (
            r"C:\ffmpeg\bin\ffprobe.exe" if os.path.exists(r"C:\ffmpeg\bin\ffprobe.exe") else "ffprobe"
        )
        self._verify_binaries()

    def _verify_binaries(self):
        """Verifikasi bahwa ffmpeg dan ffprobe siap digunakan."""
        try:
            res_ff = subprocess.run([self.ffmpeg, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res_ff.returncode != 0:
                logger.warning(f"FFmpeg binary test non-zero code: {self.ffmpeg}")
        except Exception as e:
            logger.warning(f"FFmpeg tidak ditemukan di '{self.ffmpeg}': {e}. Pastikan FFmpeg terinstall di PATH.")

    def probe_video(self, video_path: str) -> Dict[str, Any]:
        """
        Membaca dimensi (lebar, tinggi), codec, durasi dari video.
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"File video tidak ditemukan: {video_path}")

        cmd = [
            self.ffprobe,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration,r_frame_rate,codec_name",
            "-of", "json",
            video_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
        if res.returncode != 0:
            raise RuntimeError(f"FFprobe gagal: {res.stderr}")

        import json
        info = json.loads(res.stdout)
        streams = info.get("streams", [])
        if not streams:
            raise ValueError(f"Tidak ada stream video yang terdeteksi di {video_path}")

        stream = streams[0]
        width = int(stream.get("width", 0))
        height = int(stream.get("height", 0))
        return {
            "width": width,
            "height": height,
            "codec": stream.get("codec_name"),
            "is_portrait": height > width,
            "aspect_ratio": f"{width}:{height}"
        }

    def calculate_crop(self, width: int, height: int) -> int:
        """
        Menghitung pixel top-crop berdasarkan rasio dan resolusi video:
        - Portrait (Vertikal, e.g. 1080x1920):
          Tinggi >= 1200px: crop 58px
          Tinggi < 1200px: crop 46px
        - Landscape (Horizontal, e.g. 1920x1080):
          Lebar >= 1200px: crop 38px
          Lebar < 1200px: crop 32px
        """
        if height > width:  # Portrait / Vertikal (9:16)
            return 58 if height >= 1200 else 46
        else:               # Landscape / Horizontal (16:9)
            return 38 if width >= 1200 else 32

    def clean_video(
        self,
        input_path: str,
        output_path: str,
        custom_crop_h: Optional[int] = None,
        crf: int = 18,
        preset: str = "fast"
    ) -> bool:
        """
        Membersihkan watermark RunningHub dari input_path dan menyimpannya ke output_path.
        - Memotong strip atas watermark
        - Mereskalasi kembali ke resolusi semula
        - Menyalin stream audio asli (-c:a copy) tanpa re-encode audio
        - Mengaktifkan +faststart untuk streaming web cepat
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file tidak ditemukan: {input_path}")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        # 1. Analisis dimensi
        specs = self.probe_video(input_path)
        w, h = specs["width"], specs["height"]
        crop_h = custom_crop_h if custom_crop_h is not None else self.calculate_crop(w, h)

        logger.info(f"Memproses Video: {w}x{h} ({'Portrait' if specs['is_portrait'] else 'Landscape'}) | Top-Crop: {crop_h}px")

        # 2. Filter Graph: Crop bagian atas -> Rescale kembali ke resolusi awal
        vf_filter = f"crop=iw:ih-{crop_h}:0:{crop_h},scale={w}:{h}"

        cmd = [
            self.ffmpeg,
            "-y",
            "-i", input_path,
            "-vf", vf_filter,
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "copy",
            output_path
        ]

        logger.info(f"Menjalankan FFmpeg...")
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)

        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1024:
            in_sz = os.path.getsize(input_path) / (1024 * 1024)
            out_sz = os.path.getsize(output_path) / (1024 * 1024)
            logger.info(f"✅ Sukses! File bersih: {output_path} ({out_sz:.2f} MB, input: {in_sz:.2f} MB)")
            return True
        else:
            err = res.stderr.decode("utf-8", errors="ignore")
            logger.error(f"❌ FFmpeg Gagal (code {res.returncode}): {err[:300]}")
            return False

    def clean_bytes(self, raw_bytes: bytes, task_id: str = "task") -> bytes:
        """
        Membersihkan watermark langsung dari raw bytes di memori (menggunakan temporary files).
        Cocok untuk integrasi langsung di Web API / Flask / FastAPI server.
        """
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f_in:
            tmp_in = f_in.name
            f_in.write(raw_bytes)

        tmp_out = tmp_in.replace(".mp4", f"_clean_{task_id}.mp4")
        try:
            success = self.clean_video(tmp_in, tmp_out)
            if success and os.path.exists(tmp_out):
                with open(tmp_out, "rb") as f_res:
                    return f_res.read()
            return raw_bytes
        finally:
            for p in (tmp_in, tmp_out):
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
