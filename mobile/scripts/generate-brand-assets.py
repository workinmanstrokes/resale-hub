"""Generates Resale Hub's original brand assets (icon, adaptive icon layers, splash,
favicon, Play feature graphic). Run from mobile/: python3 scripts/generate-brand-assets.py
Design: a white price tag with a two-arrow "resale loop" on a teal gradient.
Copyright (c) 2026 Diddlerrr. All rights reserved."""
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SS = 4  # supersampling factor
TEAL_LIGHT = (20, 184, 166)
TEAL = (15, 118, 110)
TEAL_DARK = (17, 78, 74)
AMBER = (245, 158, 11)
WHITE = (255, 255, 255)


def gradient(size, c1=TEAL_LIGHT, c2=TEAL_DARK):
    w, h = size
    g = Image.new("RGB", (w, h))
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return g


def arrow_arc(d, cx, cy, r, start, end, width, color, head):
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, start, end, fill=color, width=width)
    # arrowhead at `end` angle, pointing along the arc direction (clockwise in PIL coords)
    a = math.radians(end)
    px, py = cx + r * math.cos(a), cy + r * math.sin(a)
    tx, ty = -math.sin(a), math.cos(a)  # tangent (direction of increasing angle)
    nx, ny = math.cos(a), math.sin(a)  # normal
    tip = (px + tx * head * 1.1, py + ty * head * 1.1)
    l = (px + nx * head * 0.95 - tx * head * 0.15, py + ny * head * 0.95 - ty * head * 0.15)
    rr = (px - nx * head * 0.95 - tx * head * 0.15, py - ny * head * 0.95 - ty * head * 0.15)
    d.polygon([tip, l, rr], fill=color)


def tag_layer(size, scale, mono=False):
    """White price tag + teal resale loop, rotated 45 degrees, on transparency."""
    S = size * SS
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    k = S / 1024 * scale
    cx = cy = S / 2
    tag = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(tag)
    # tag silhouette: body + tapered end, corners rounded by blur-and-threshold
    x0, x1, y0, y1 = cx - 230 * k, cx + 330 * k, cy - 200 * k, cy + 200 * k
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle([x0, y0, x1, y1], fill=255)
    md.polygon([(x0 + 2, y0), (cx - 420 * k, cy - 95 * k), (cx - 420 * k, cy + 95 * k), (x0 + 2, y1)], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(34 * k)).point(lambda v: 255 if v > 150 else 0)
    tag.paste(WHITE + (255,), (0, 0), mask)
    # punched hole
    hr = 40 * k
    hx = cx - 300 * k
    d.ellipse([hx - hr, cy - hr, hx + hr, cy + hr], fill=(0, 0, 0, 0))
    # resale loop: two arcs with arrowheads
    lc = (0, 0, 0, 0) if mono else TEAL + (255,)
    lx, r, w, head = cx + 70 * k, 120 * k, int(46 * k), 52 * k
    arrow_arc(d, lx, cy, r, 200, 330, w, lc, head)
    arrow_arc(d, lx, cy, r, 20, 150, w, lc, head)
    if not mono:
        dot = 26 * k
        d.ellipse([lx - dot, cy - dot, lx + dot, cy + dot], fill=AMBER + (255,))
    tag = tag.rotate(35, resample=Image.BICUBIC, center=(cx, cy))
    if not mono:
        shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        shadow.putalpha(tag.getchannel("A").point(lambda a: int(a * 0.28)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(18 * k))
        layer.alpha_composite(shadow, (int(10 * k), int(22 * k)))
    layer.alpha_composite(tag)
    return layer.resize((size, size), Image.LANCZOS)


def main():
    # iOS / store icon: opaque, full bleed
    icon = gradient((1024, 1024)).convert("RGBA")
    icon.alpha_composite(tag_layer(1024, 0.80))
    icon.convert("RGB").save("assets/icon.png", optimize=True)
    icon.convert("RGB").resize((512, 512), Image.LANCZOS).save("assets/store/play-icon-512.png", optimize=True)
    icon.convert("RGB").resize((48, 48), Image.LANCZOS).save("assets/favicon.png", optimize=True)

    # Android adaptive icon (foreground kept inside the 66% safe zone)
    gradient((512, 512)).save("assets/android-icon-background.png", optimize=True)
    tag_layer(512, 0.56).save("assets/android-icon-foreground.png", optimize=True)
    mono = tag_layer(432, 0.56, mono=True)
    white = Image.new("RGBA", mono.size, (255, 255, 255, 0))
    white.putalpha(mono.getchannel("A"))
    white.save("assets/android-icon-monochrome.png", optimize=True)

    # Splash image (shown centred on #0F766E)
    tag_layer(1024, 0.95).save("assets/splash-icon.png", optimize=True)

    # Google Play feature graphic 1024x500
    fg = gradient((1024, 500)).convert("RGBA")
    fg.alpha_composite(tag_layer(420, 0.95), (40, 40))
    d = ImageDraw.Draw(fg)
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    d.text((480, 170), "Resale Hub", font=ImageFont.truetype(bold, 84), fill=WHITE)
    d.text((484, 280), "Find deals. List it on eBay.", font=ImageFont.truetype(reg, 38), fill=(220, 252, 246))
    fg.convert("RGB").save("assets/store/feature-graphic.png", optimize=True)


if __name__ == "__main__":
    main()
