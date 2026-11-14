"""
=============================================================================
CLI TOOL - PEMBERSIH WATERMARK RUNNINGHUB
=============================================================================
Contoh Perintah Penggunaan:
1. Dari URL RunningHub:
   python cli.py --url "https://rh-hk-images.xiaoyaoyou.com/.../output.mp4" --id "task_123"

2. Dari File Video Lokal:
   python cli.py --input "my_video.mp4" --output "clean_video.mp4"

3. Batch proses seluruh folder:
   python cli.py --batch "D:/video_folder"
=============================================================================
"""
import os
import sys
import argparse
from watermark_cleaner import RunningHubWatermarkCleaner
from pipeline import RunningHubPostProcessPipeline


def main():
    parser = argparse.ArgumentParser(description="Pembersih Watermark RunningHub AI via FFmpeg")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", type=str, help="URL video hasil render dari RunningHub")
    group.add_argument("--input", "-i", type=str, help="Path file video lokal yang ada watermarknya")
    group.add_argument("--batch", "-b", type=str, help="Folder berisi file .mp4 untuk dibersihkan sekaligus")

    parser.add_argument("--id", type=str, default="task_output", help="Task ID atau nama unik untuk file output")
    parser.add_argument("--output", "-o", type=str, default=None, help="Path tujuan file hasil bersih")
    parser.add_argument("--crop", type=int, default=None, help="Tinggi crop atas khusus dalam pixel (opsional, default auto)")
    parser.add_argument("--crf", type=int, default=18, help="Kualitas encoder FFmpeg (CRF, default 18)")
    parser.add_argument("--keep-raw", action="store_true", help="Simpan juga file mentah asli jika memakai mode --url")

    args = parser.parse_args()

    cleaner = RunningHubWatermarkCleaner()

    if args.url:
        out_dir = os.path.abspath(args.output) if args.output and os.path.isdir(args.output) else (os.path.dirname(os.path.abspath(args.output)) if args.output else "./hasil_bersih")
        pipeline = RunningHubPostProcessPipeline(output_dir=out_dir, cleaner=cleaner)
        res = pipeline.process(task_id=args.id, video_url=args.url, keep_raw=args.keep_raw)
        if res["success"]:
            print(f"\n[SUKSES] File Bersih: {res['clean_video_path']}")
        else:
            print(f"\n[GAGAL] {res['error']}")
            sys.exit(1)

    elif args.input:
        if not os.path.exists(args.input):
            print(f"Error: File input tidak ditemukan: {args.input}")
            sys.exit(1)
        out_path = args.output or os.path.splitext(args.input)[0] + "_no_wm.mp4"
        ok = cleaner.clean_video(args.input, out_path, custom_crop_h=args.crop, crf=args.crf)
        if ok:
            print(f"\n[SUKSES] File Bersih: {out_path}")
        else:
            print("\n[GAGAL] Proses pembersihan gagal.")
            sys.exit(1)

    elif args.batch:
        if not os.path.isdir(args.batch):
            print(f"Error: Folder batch tidak ditemukan: {args.batch}")
            return
        out_dir = args.output or os.path.join(args.batch, "clean_outputs")
        os.makedirs(out_dir, exist_ok=True)
        files = [f for f in os.listdir(args.batch) if f.lower().endswith(".mp4") and not f.startswith("clean_")]
        print(f"Ditemukan {len(files)} file video untuk dibersihkan...")
        for idx, f in enumerate(files, 1):
            inp = os.path.join(args.batch, f)
            out = os.path.join(out_dir, f"clean_{f}")
            print(f"\n[{idx}/{len(files)}] Memproses: {f}")
            cleaner.clean_video(inp, out, custom_crop_h=args.crop, crf=args.crf)
        print(f"\n[SELESAI] Semua output tersimpan di: {out_dir}")


if __name__ == "__main__":
    main()
