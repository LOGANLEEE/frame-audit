"""Generate Figma Community assets for Frame Audit.

Concept: a screen frame (solid) with an oversized shape bleeding past its edge —
the part inside the frame is opaque, the part outside is ghosted. That IS the bug
the plugin finds, drawn literally.

Usage: python3 assets/make_assets.py   (requires Pillow; macOS system fonts)
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))

INK = (24, 24, 27)
PAPER = (250, 250, 250)
FRAME_FILL = (255, 255, 255)
ALERT = (220, 38, 38)
ALERT_GHOST = (220, 38, 38, 46)
MUTED = (113, 113, 122)


def find_font(names, size):
    roots = ["/System/Library/Fonts/Supplemental/", "/System/Library/Fonts/", "/Library/Fonts/"]
    for n in names:
        for r in roots:
            p = os.path.join(r, n)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except OSError:
                    pass
    return ImageFont.load_default()


def draw_motif(img, cx, cy, frame_w, frame_h, orb_r, radius, stroke):
    """Frame with an orb that overflows it. Ghost outside, solid inside."""
    fx0, fy0 = cx - frame_w // 2, cy - frame_h // 2
    fx1, fy1 = fx0 + frame_w, fy0 + frame_h

    # frame body
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=radius, fill=FRAME_FILL,
                        outline=INK, width=stroke)

    # orb, ghosted, on its own layer so it can spill outside the frame
    ghost = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ghost).ellipse(
        [cx - orb_r + frame_w // 4, cy - orb_r + frame_h // 5,
         cx + orb_r + frame_w // 4, cy + orb_r + frame_h // 5],
        fill=ALERT_GHOST,
    )
    img.alpha_composite(ghost)

    # the same orb clipped to the frame — solid, i.e. the sliver you actually see
    solid = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(solid).ellipse(
        [cx - orb_r + frame_w // 4, cy - orb_r + frame_h // 5,
         cx + orb_r + frame_w // 4, cy + orb_r + frame_h // 5],
        fill=ALERT + (255,),
    )
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [fx0 + stroke, fy0 + stroke, fx1 - stroke, fy1 - stroke], radius=radius, fill=255
    )
    img.paste(solid, (0, 0), Image.composite(mask, Image.new("L", img.size, 0),
                                             solid.split()[3].point(lambda a: 255 if a else 0)))
    # redraw the frame outline so the orb never covers it
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=radius, outline=INK, width=stroke)
    return (fx0, fy0, fx1, fy1)


# ---------------- icon 128x128 ----------------
S = 4  # supersample
icon = Image.new("RGBA", (128 * S, 128 * S), PAPER + (255,))
draw_motif(icon, 62 * S, 64 * S, frame_w=68 * S, frame_h=98 * S,
           orb_r=46 * S, radius=10 * S, stroke=6 * S)
icon = icon.resize((128, 128), Image.LANCZOS)
icon.convert("RGB").save(f"{OUT}/icon.png")

# ---------------- thumbnail 1920x1080 ----------------
W, H = 1920, 1080
thumb = Image.new("RGBA", (W, H), PAPER + (255,))
d = ImageDraw.Draw(thumb)

title_f = find_font(["Helvetica.ttc", "Arial.ttf"], 96)
sub_f = find_font(["Helvetica.ttc", "Arial.ttf"], 44)
mono_f = find_font(["Menlo.ttc", "Courier New.ttf"], 34)
mono_b = find_font(["Menlo.ttc", "Courier New Bold.ttf"], 34)

d.text((120, 286), "Frame Audit", font=title_f, fill=INK)
d.text((120, 410), "for Dev Mode", font=title_f, fill=MUTED)
d.text((124, 556), "Find the layers hiding outside your frames.", font=sub_f, fill=INK)
d.text((124, 618), "Audit only. Nothing deleted, nothing leaves your machine.",
       font=sub_f, fill=MUTED)

# finding chips — measure the rule label so the detail never collides with it
y = 748
CHIP_L, CHIP_R, PAD = 124, 1180, 26
for rule, text, colour in [
    ("OVERFLOW", '1594x1699 sticks 679px outside "Rewards"', ALERT),
    ("GIANT", "7.7x the screen area — clipped, invisible", (185, 28, 28)),
]:
    d.rounded_rectangle([CHIP_L, y, CHIP_R, y + 76], radius=12, fill=(240, 240, 243))
    d.text((CHIP_L + PAD, y + 21), rule, font=mono_b, fill=colour)
    label_w = d.textlength(rule, font=mono_b)
    d.text((CHIP_L + PAD + label_w + 24, y + 21), text, font=mono_f, fill=(82, 82, 91))
    y += 96

draw_motif(thumb, 1530, 540, frame_w=360, frame_h=540, orb_r=250, radius=26, stroke=6)
thumb.convert("RGB").save(f"{OUT}/thumbnail.png")

print("wrote", os.listdir(OUT))
