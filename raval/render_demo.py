"""Burn explanatory Persian captions below the unmodified browser recording.

Development-only export: requires an ffmpeg build with libass and an installed
Persian font. The delivered application itself does not invoke this script.
"""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def ass_time(seconds):
    centiseconds = int(round(seconds * 100))
    return f"{centiseconds // 360000}:{centiseconds // 6000 % 60:02}:{centiseconds // 100 % 60:02}.{centiseconds % 100:02}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fonts", default="/tmp/raval-fonts")
    args = parser.parse_args()
    folder = ROOT / "evidence/recording"
    manifest = json.loads((folder / "manifest.json").read_text())
    video = folder / manifest["video_file"]
    captions = folder / "captions.ass"
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1000
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,20,&H00FFFFFF,&H00FFFFFF,&H00132B3B,&H00132B3B,0,0,0,0,100,100,0,0,1,0,0,2,35,35,14,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for index, scene in enumerate(manifest["scenes"]):
        end = manifest["scenes"][index + 1]["start"] if index + 1 < len(manifest["scenes"]) else manifest["duration_seconds"] + 1
        title = scene["title"].replace("{", "").replace("}", "")
        detail = scene["detail"].replace("{", "").replace("}", "")
        content = r"{\fs24\c&H00D2E8A7&}" + title + r"{\r}\N{\fs20}" + detail
        lines.append(f"Dialogue: 0,{ass_time(scene['start'])},{ass_time(end)},Default,,0,0,0,,{content}")
    captions.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    output = ROOT / "deliverables/RAVAL-VC005-Demo.mp4"
    output.parent.mkdir(exist_ok=True)
    filters = f"pad=1440:1000:0:0:color=0x132b3b,subtitles=filename='{captions}':fontsdir='{Path(args.fonts)}'"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", str(video), "-vf", filters,
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "25",
                    "-threads", "4", "-movflags", "+faststart", "-an", str(output)], check=True)
    print(output)


if __name__ == "__main__":
    main()
