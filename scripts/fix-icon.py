#!/usr/bin/env python3
"""
把生成的图标图规范化成合格的 macOS 应用图标：
1. 自动裁出圆角方块主体（丢掉画进像素里的假棋盘格背景）；
2. 缩放到苹果图标网格的标准主体尺寸（1024 画布中占 824）；
3. 用连续圆角（超椭圆近似）蒙版切出真透明圆角。

用法: python3 scripts/fix-icon.py <input.png> <output.png>
"""
import sys

from PIL import Image, ImageDraw

CANVAS = 1024
CONTENT = 824  # Apple 图标网格：主体 824/1024
RADIUS = int(CONTENT * 0.2237)  # macOS squircle 视觉半径


def content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """主体 = 非中性色像素（棋盘格/白边是 R≈G≈B 的中性灰）。"""
    rgb = img.convert("RGB")
    px = rgb.load()
    w, h = rgb.size
    left, top, right, bottom = w, h, 0, 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if abs(r - b) > 14 or abs(r - g) > 14:  # 暖色调 = 图标主体
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)
    if right <= left:
        return (0, 0, w, h)
    return (left, top, right + 1, bottom + 1)


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    img = Image.open(src).convert("RGBA")

    box = content_bbox(img)
    # bbox 按最长边取正方形（防止阴影把 bbox 拉歪），再向内收 2.5%
    # 把混进 bbox 的阴影 / 棋盘格灰边推到蒙版外。
    bw, bh = box[2] - box[0], box[3] - box[1]
    size = max(bw, bh)
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    half = int(size * 0.475)
    img = img.crop((cx - half, cy - half, cx + half, cy + half))
    img = img.resize((CONTENT, CONTENT), Image.LANCZOS)

    mask = Image.new("L", (CONTENT, CONTENT), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CONTENT - 1, CONTENT - 1), radius=RADIUS, fill=255
    )

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - CONTENT) // 2
    canvas.paste(img, (offset, offset), mask)
    canvas.save(dst, "PNG")
    print(f"{dst}: {CANVAS}x{CANVAS}, content {CONTENT}, radius {RADIUS}")


if __name__ == "__main__":
    main()
