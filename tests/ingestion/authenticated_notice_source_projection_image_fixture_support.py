from __future__ import annotations

from .authenticated_notice_source_projection_base_support import *  # noqa: F401,F403


def _build_map_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (360, 280), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 360, 48), fill=(169, 215, 128))
    draw.rectangle((24, 64, 208, 248), fill=(88, 157, 229))
    draw.rectangle((232, 72, 336, 132), fill=(59, 167, 135))
    draw.rectangle((232, 152, 336, 212), fill=(59, 167, 135))
    draw.rectangle((96, 144, 128, 176), fill=(239, 124, 52))
    draw.rectangle((136, 144, 168, 176), fill=(239, 124, 52))
    draw.rectangle((176, 144, 208, 176), fill=(239, 124, 52))
    draw.line((212, 60, 212, 252), fill=(255, 255, 255), width=6)
    draw.line((32, 140, 200, 140), fill=(255, 255, 255), width=6)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_qr_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    module_count = 29
    module_size = 8
    image = Image.new(
        "RGB",
        (module_count * module_size, module_count * module_size),
        "white",
    )
    draw = ImageDraw.Draw(image)

    def fill_module(x: int, y: int, *, color: str = "black") -> None:
        draw.rectangle(
            (
                x * module_size,
                y * module_size,
                (x + 1) * module_size - 1,
                (y + 1) * module_size - 1,
            ),
            fill=color,
        )

    def draw_finder(origin_x: int, origin_y: int) -> None:
        for dx in range(7):
            for dy in range(7):
                border = dx in {0, 6} or dy in {0, 6}
                center = 2 <= dx <= 4 and 2 <= dy <= 4
                if border or center:
                    fill_module(origin_x + dx, origin_y + dy)

    reserved: set[tuple[int, int]] = set()
    for origin in ((0, 0), (module_count - 7, 0), (0, module_count - 7)):
        ox, oy = origin
        draw_finder(ox, oy)
        for dx in range(8):
            for dy in range(8):
                reserved.add((ox + dx, oy + dy))

    for x in range(module_count):
        if (x, 6) not in reserved:
            fill_module(x, 6, color="black" if x % 2 == 0 else "white")
            reserved.add((x, 6))
    for y in range(module_count):
        if (6, y) not in reserved:
            fill_module(6, y, color="black" if y % 2 == 0 else "white")
            reserved.add((6, y))

    for x in range(module_count):
        for y in range(module_count):
            if (x, y) in reserved:
                continue
            if ((x * 17) + (y * 31) + (x * y)) % 5 in {0, 1}:
                fill_module(x, y)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_ui_fragment_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (720, 48), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    for index, label_width in enumerate((96, 88, 104, 92)):
        offset_x = 24 + index * 156
        draw.rectangle(
            (offset_x, 12, offset_x + label_width, 34),
            outline=(120, 120, 120, 255),
            fill=(248, 248, 248, 255),
        )
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_certificate_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (960, 640), (252, 248, 240))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, 942, 622), outline=(148, 48, 48), width=10)
    draw.rectangle((48, 48, 912, 592), outline=(210, 180, 120), width=4)
    draw.rectangle((112, 162, 848, 206), fill=(240, 240, 240))
    draw.rectangle((188, 270, 772, 294), fill=(225, 225, 225))
    draw.rectangle((220, 334, 740, 356), fill=(225, 225, 225))
    draw.ellipse((720, 448, 856, 584), outline=(180, 48, 48), width=10)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_mobile_screenshot_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (360, 780), (248, 242, 232))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 360, 64), fill=(232, 124, 56))
    draw.rectangle((0, 716, 360, 780), fill=(255, 255, 255))
    draw.rounded_rectangle((24, 104, 336, 180), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((24, 204, 336, 420), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((24, 448, 336, 616), radius=12, fill=(255, 255, 255))
    draw.rounded_rectangle((32, 636, 172, 688), radius=12, fill=(230, 91, 59))
    draw.rounded_rectangle((188, 636, 328, 688), radius=12, fill=(193, 141, 83))
    for top in (124, 146, 228, 252, 276, 476, 500, 524):
        draw.rectangle((48, top, 280, top + 10), fill=(222, 222, 222))
    draw.rectangle((48, 310, 312, 394), fill=(216, 216, 216))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_compact_mobile_screenshot_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (148, 332), (246, 240, 232))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 148, 34), fill=(232, 124, 56))
    draw.rectangle((0, 298, 148, 332), fill=(255, 255, 255))
    draw.rounded_rectangle((10, 48, 138, 84), radius=6, fill=(255, 255, 255))
    draw.rounded_rectangle((10, 96, 138, 196), radius=8, fill=(255, 255, 255))
    draw.rounded_rectangle((10, 206, 138, 274), radius=8, fill=(255, 255, 255))
    draw.rounded_rectangle((14, 280, 66, 314), radius=6, fill=(228, 92, 58))
    draw.rounded_rectangle((82, 280, 134, 314), radius=6, fill=(196, 144, 83))
    for top in (58, 68, 106, 118, 130, 216, 228, 240):
        draw.rectangle((22, top, 118, top + 4), fill=(220, 220, 220))
    draw.rectangle((22, 146, 126, 186), fill=(214, 214, 214))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_small_program_code_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (132, 132), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for x in range(0, 132, 8):
        draw.rectangle((x, 0, x + 3, 12), fill=(0, 0, 0))
        draw.rectangle((x, 120, x + 3, 132), fill=(0, 0, 0))
    for y in range(12, 120, 8):
        draw.rectangle((0, y, 12, y + 3), fill=(0, 0, 0))
        draw.rectangle((120, y, 132, y + 3), fill=(0, 0, 0))
    draw.ellipse((34, 34, 98, 98), fill=(214, 48, 44))
    draw.ellipse((48, 48, 84, 84), fill=(255, 255, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_tiny_decorative_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (37, 31), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.polygon(((2, 18), (14, 6), (28, 12), (34, 2), (34, 26), (18, 30)), fill=(255, 128, 92))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_promotional_banner_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (960, 540), (171, 18, 24))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 960, 160), fill=(190, 32, 36))
    draw.rectangle((0, 160, 960, 332), fill=(182, 24, 30))
    draw.rectangle((0, 332, 960, 540), fill=(233, 124, 86))
    draw.rectangle((96, 118, 864, 186), fill=(255, 232, 232))
    draw.rectangle((176, 220, 784, 262), fill=(232, 232, 255))
    for offset in range(8):
        center_x = 92 + offset * 108
        draw.ellipse((center_x, 392, center_x + 48, 440), fill=(236, 222, 194))
        draw.rectangle((center_x + 10, 438, center_x + 38, 502), fill=(62, 66, 102))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_activity_notice_inline_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1327, 641), (250, 250, 250))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1327, 92), fill=(236, 240, 246))
    draw.rectangle((72, 134, 1255, 176), fill=(212, 218, 228))
    draw.rectangle((72, 214, 1168, 234), fill=(224, 226, 232))
    draw.rectangle((72, 252, 1184, 272), fill=(224, 226, 232))
    draw.rectangle((72, 290, 1104, 310), fill=(224, 226, 232))
    draw.rectangle((72, 348, 208, 376), fill=(206, 212, 222))
    draw.rectangle((72, 398, 412, 416), fill=(224, 226, 232))
    draw.rectangle((72, 434, 386, 452), fill=(224, 226, 232))
    draw.rectangle((72, 490, 208, 518), fill=(206, 212, 222))
    draw.rectangle((72, 540, 446, 558), fill=(224, 226, 232))
    draw.rectangle((72, 576, 428, 594), fill=(224, 226, 232))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_table_like_png_bytes() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (720, 420), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 712, 412), outline=(32, 32, 32), width=3)
    for y in (72, 192, 312):
        draw.line((8, y, 712, y), fill=(32, 32, 32), width=3)
    for x in (160, 420):
        draw.line((x, 72, x, 412), fill=(32, 32, 32), width=3)
    draw.rectangle((248, 22, 472, 40), fill=(220, 220, 220))
    for top in (112, 138, 232, 258, 352, 378):
        draw.rectangle((194, top, 364, top + 12), fill=(214, 214, 214))
    for top in (112, 138, 164, 232, 258, 284, 352, 378):
        draw.rectangle((466, top, 648, top + 12), fill=(214, 214, 214))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


__all__ = [name for name in globals() if not name.startswith("__")]
