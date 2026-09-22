"""Download provider logos and normalize to 128x128 PNGs in assets/providers/."""
import io
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "assets", "providers")
os.makedirs(OUT, exist_ok=True)

DOMAINS = {
    "cloudflare": "cloudflare.com",
    "google": "google.com",
    "quad9": "quad9.net",
    "opendns": "opendns.com",
    "adguard": "adguard.com",
    "adguard-family": "adguard.com",
    "cleanbrowsing": "cleanbrowsing.org",
    "comodo": "comodo.com",
    "level3": "lumen.com",
    "verisign": "verisign.com",
    "controld": "controld.com",
    "nextdns": "nextdns.io",
}

SOURCES = [
    lambda d: f"https://logo.clearbit.com/{d}?size=128",
    lambda d: f"https://unavatar.io/{d}?fallback=false",
    lambda d: f"https://www.google.com/s2/favicons?domain={d}&sz=128",
]

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DNS-Switcher/1.0"}


def fetch(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            data = r.read()
        if len(data) < 500:
            return None
        return data
    except Exception as e:  # noqa: BLE001
        print(f"    miss {url}: {e}")
        return None


def main() -> int:
    from PIL import Image

    ok, failed = 0, []
    for pid, domain in DOMAINS.items():
        data = None
        for src in SOURCES:
            url = src(domain)
            print(f"[{pid}] trying {url}")
            data = fetch(url)
            if data:
                print(f"[{pid}] got {len(data)} bytes from {url}")
                break
        dest = os.path.join(OUT, f"{pid}.png")
        if not data:
            failed.append(pid)
            continue
        try:
            img = Image.open(io.BytesIO(data)).convert("RGBA")
            img.thumbnail((128, 128), Image.LANCZOS)
            # keep transparency; pad to square on transparent canvas
            canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
            canvas.alpha_composite(img, ((128 - img.width) // 2, (128 - img.height) // 2))
            canvas.save(dest)
            print(f"[{pid}] saved {dest}")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"[{pid}] decode failed: {e}")
            failed.append(pid)
    print(f"done: {ok} ok, {len(failed)} failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
