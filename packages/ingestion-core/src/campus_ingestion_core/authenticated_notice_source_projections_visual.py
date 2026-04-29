from __future__ import annotations

import colorsys
from io import BytesIO
from itertools import pairwise

_VISUAL_CLASSIFIER_SAMPLE_EDGE = 128
_VISUAL_CLASSIFIER_AVERAGE_SATURATION_THRESHOLD = 0.15
_VISUAL_CLASSIFIER_COLORFUL_PIXEL_RATIO_THRESHOLD = 0.25
_VISUAL_CLASSIFIER_DOMINANT_COLOR_SHARE_MAX = 0.45
_MACHINE_CODE_SAMPLE_EDGE = 96
_MACHINE_CODE_GRID_EDGE = 29
_MACHINE_CODE_MAX_MIDTONE_RATIO = 0.25
_MACHINE_CODE_MIN_BLACK_RATIO = 0.15
_MACHINE_CODE_MAX_BLACK_RATIO = 0.7
_MACHINE_CODE_MIN_TRANSITION_RATIO = 0.3
_MACHINE_CODE_MIN_FINDER_MATCHES = 2
_DECORATIVE_FRAGMENT_MAX_THIN_SIDE = 64
_DECORATIVE_FRAGMENT_MIN_ASPECT_RATIO = 6.0
_MOBILE_UI_MIN_ASPECT_RATIO = 1.7
_MOBILE_UI_MAX_WIDTH = 480
_MOBILE_UI_MIN_HEIGHT = 240


def _looks_like_spatial_visual_asset(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            sample = image.convert("RGB").resize(
                (_VISUAL_CLASSIFIER_SAMPLE_EDGE, _VISUAL_CLASSIFIER_SAMPLE_EDGE)
            )
            palette = sample.quantize(colors=8)
    except Exception:
        return False
    pixel_bytes = sample.tobytes()
    if not pixel_bytes:
        return False
    colorful_pixels = 0
    saturation_total = 0.0
    pixel_count = 0
    for offset in range(0, len(pixel_bytes), 3):
        red, green, blue = pixel_bytes[offset : offset + 3]
        _hue, saturation, _value = colorsys.rgb_to_hsv(
            red / 255.0,
            green / 255.0,
            blue / 255.0,
        )
        pixel_count += 1
        saturation_total += saturation
        if saturation >= 0.2:
            colorful_pixels += 1
    if pixel_count == 0:
        return False
    average_saturation = saturation_total / pixel_count
    colorful_pixel_ratio = colorful_pixels / pixel_count
    dominant_palette_share = _dominant_palette_share(palette)
    return (
        average_saturation >= _VISUAL_CLASSIFIER_AVERAGE_SATURATION_THRESHOLD
        and colorful_pixel_ratio >= _VISUAL_CLASSIFIER_COLORFUL_PIXEL_RATIO_THRESHOLD
        and dominant_palette_share <= _VISUAL_CLASSIFIER_DOMINANT_COLOR_SHARE_MAX
    )


def _looks_like_machine_readable_code_asset(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                return False
            if abs(width - height) / max(width, height) > 0.2:
                return False
            grayscale = _crop_to_dark_bbox(image.convert("L"))
            sample = grayscale.resize((_MACHINE_CODE_SAMPLE_EDGE, _MACHINE_CODE_SAMPLE_EDGE))
            sample_pixels = tuple(sample.tobytes())
            grid = grayscale.resize(
                (_MACHINE_CODE_GRID_EDGE, _MACHINE_CODE_GRID_EDGE),
                resample=Image.Resampling.NEAREST,
            )
    except Exception:
        return False
    pixel_count = len(sample_pixels)
    if pixel_count == 0:
        return False
    black_ratio = sum(1 for pixel in sample_pixels if pixel <= 96) / pixel_count
    midtone_ratio = sum(1 for pixel in sample_pixels if 96 < pixel < 192) / pixel_count
    if not (_MACHINE_CODE_MIN_BLACK_RATIO <= black_ratio <= _MACHINE_CODE_MAX_BLACK_RATIO):
        return False
    if midtone_ratio > _MACHINE_CODE_MAX_MIDTONE_RATIO:
        return False
    binary_grid = [
        [0 if grid.getpixel((x, y)) <= 128 else 1 for x in range(_MACHINE_CODE_GRID_EDGE)]
        for y in range(_MACHINE_CODE_GRID_EDGE)
    ]
    if _count_qr_finder_matches(binary_grid) < _MACHINE_CODE_MIN_FINDER_MATCHES:
        return False
    return _transition_ratio(binary_grid) >= _MACHINE_CODE_MIN_TRANSITION_RATIO


def _looks_like_decorative_inline_fragment(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
    except Exception:
        return False
    long_side = max(width, height)
    short_side = min(width, height)
    if short_side <= 0:
        return False
    if long_side <= 64 and short_side <= 64 and (long_side * short_side) >= 256:
        return True
    return (
        short_side <= _DECORATIVE_FRAGMENT_MAX_THIN_SIDE
        and (long_side / short_side) >= _DECORATIVE_FRAGMENT_MIN_ASPECT_RATIO
    )


def _looks_like_mobile_ui_screenshot(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
    except Exception:
        return False
    if width <= 0 or height <= 0:
        return False
    return (
        width <= _MOBILE_UI_MAX_WIDTH
        and height >= _MOBILE_UI_MIN_HEIGHT
        and (height / width) >= _MOBILE_UI_MIN_ASPECT_RATIO
    )


def _looks_like_promotional_hero_image(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                return False
            if (width / height) < 1.4:
                return False
            sample = image.convert("RGB").resize(
                (_VISUAL_CLASSIFIER_SAMPLE_EDGE, _VISUAL_CLASSIFIER_SAMPLE_EDGE)
            )
            palette = sample.quantize(colors=8)
    except Exception:
        return False
    pixel_bytes = sample.tobytes()
    if not pixel_bytes:
        return False
    colorful_pixels = 0
    saturation_total = 0.0
    pixel_count = 0
    for offset in range(0, len(pixel_bytes), 3):
        red, green, blue = pixel_bytes[offset : offset + 3]
        _hue, saturation, _value = colorsys.rgb_to_hsv(
            red / 255.0,
            green / 255.0,
            blue / 255.0,
        )
        pixel_count += 1
        saturation_total += saturation
        if saturation >= 0.2:
            colorful_pixels += 1
    if pixel_count == 0:
        return False
    average_saturation = saturation_total / pixel_count
    colorful_pixel_ratio = colorful_pixels / pixel_count
    dominant_palette_share = _dominant_palette_share(palette)
    return (
        average_saturation >= 0.18 and colorful_pixel_ratio >= 0.2 and dominant_palette_share <= 0.7
    )


def _dominant_palette_share(image) -> float:
    counts = image.getcolors()
    if not counts:
        return 1.0
    total = sum(int(count) for count, _index in counts)
    if total <= 0:
        return 1.0
    return max(int(count) for count, _index in counts) / total


def _count_qr_finder_matches(grid: list[list[int]]) -> int:
    size = len(grid)
    if size < 7:
        return 0
    matches = 0
    for origin_x, origin_y in ((0, 0), (size - 7, 0), (0, size - 7)):
        if _matches_qr_finder_pattern(grid, origin_x=origin_x, origin_y=origin_y):
            matches += 1
    return matches


def _matches_qr_finder_pattern(
    grid: list[list[int]],
    *,
    origin_x: int,
    origin_y: int,
) -> bool:
    matched = 0
    total = 0
    for dy in range(7):
        for dx in range(7):
            expected_black = dx in {0, 6} or dy in {0, 6} or (2 <= dx <= 4 and 2 <= dy <= 4)
            pixel = grid[origin_y + dy][origin_x + dx]
            if (pixel == 0) == expected_black:
                matched += 1
            total += 1
    return total > 0 and matched / total >= 0.55


def _transition_ratio(grid: list[list[int]]) -> float:
    size = len(grid)
    if size <= 1:
        return 0.0
    row_transitions = 0
    col_transitions = 0
    max_row_transitions = 0
    max_col_transitions = 0
    for row in grid:
        row_transitions += sum(1 for left, right in pairwise(row) if left != right)
        max_row_transitions += len(row) - 1
    for col_index in range(size):
        column = [grid[row_index][col_index] for row_index in range(size)]
        col_transitions += sum(1 for top, bottom in pairwise(column) if top != bottom)
        max_col_transitions += len(column) - 1
    if max_row_transitions <= 0 or max_col_transitions <= 0:
        return 0.0
    return min(
        row_transitions / max_row_transitions,
        col_transitions / max_col_transitions,
    )


def _crop_to_dark_bbox(image):
    pixels = image.load()
    width, height = image.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] <= 180:
                xs.append(x)
                ys.append(y)
    if not xs or not ys:
        return image
    return image.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))


__all__ = (
    "_looks_like_decorative_inline_fragment",
    "_looks_like_machine_readable_code_asset",
    "_looks_like_mobile_ui_screenshot",
    "_looks_like_promotional_hero_image",
    "_looks_like_spatial_visual_asset",
)
