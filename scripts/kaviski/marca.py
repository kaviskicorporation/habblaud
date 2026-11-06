"""Fork Kaviski (KAVISKI.md): gera a marca Kubo a partir da logo circular feita por IA.

Entrada: a logo mestre (PNG quadrado com alfa, o círculo ocupando o quadro), guardada em
client/public/assets/brand/kubo-1024.png. Saída: os mesmos arquivos de client/public/assets/brand/ que o original usa
(favicon, ícones do app, mark do topo) e a placa da recepção e o og-image com o nome, na fonte bitmap do pixelart.py.

Uso (precisa de Pillow e numpy):
    python3 scripts/kaviski/marca.py [logo-mestre.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "assets"))
from pixelart import draw_text, hex_rgba, text_image, text_width  # noqa: E402

NOME = "Kubo"
BRAND = ROOT / "client" / "public" / "assets" / "brand"
FUNDO = "#12151d"


def mestre(path: Path) -> Image.Image:
    """Logo recortada no círculo (caixa do alfa) e centralizada num quadrado."""
    img = Image.open(path).convert("RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    img = img.crop(box)
    lado = max(img.size)
    quadrado = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    quadrado.paste(img, ((lado - img.width) // 2, (lado - img.height) // 2))
    return quadrado


def reduzir(img: Image.Image, size: int, fundo: str | None = None, margem: float = 0.0) -> Image.Image:
    inner = round(size * (1 - 2 * margem))
    small = img.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), hex_rgba(fundo) if fundo else (0, 0, 0, 0))
    out.alpha_composite(small, ((size - inner) // 2, (size - inner) // 2))
    return out


def signage() -> Image.Image:
    """Placa da recepção, 64x16: a mesma chapa do original, com "Kubo" ("Ku" claro, "bo" na cor das janelas)."""
    w, h = 64, 16
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    outline, top, face, bottom = hex_rgba("#1c2541"), hex_rgba("#3a4a70"), hex_rgba("#2a3656"), hex_rgba("#222b47")
    for y in range(h):
        for x in range(w):
            if x in (0, w - 1) and y in (0, h - 1):
                continue
            if x in (0, w - 1) or y in (0, h - 1):
                px[x, y] = outline
            elif y == 1:
                px[x, y] = top
            elif y == h - 2:
                px[x, y] = bottom
            else:
                px[x, y] = face
    for sx in (3, w - 4):
        px[sx, 7] = hex_rgba("#c9d3e3")
        px[sx, 8] = hex_rgba("#7d8aa3")
    a, b = NOME[:2], NOME[2:]
    tx, ty = (w - text_width(NOME)) // 2, 4
    bx = tx + text_width(a) + 1
    draw_text(img, tx, ty + 1, a, "#151c33")
    draw_text(img, bx, ty + 1, b, "#151c33")
    draw_text(img, tx, ty, a, "#f4f1ea")
    draw_text(img, bx, ty, b, "#7cc8ff")
    return img


def og_image(logo: Image.Image) -> Image.Image:
    """Prévia do link (1200x630): fundo da página, a logo à esquerda, o nome e a frase em pixels à direita."""
    w, h = 1200, 630
    img = Image.new("RGBA", (w, h), hex_rgba(FUNDO))
    d = ImageDraw.Draw(img)
    for y in range(h):  # leve gradiente para o azul da logo
        t = y / h
        d.line([(0, y), (w, y)], fill=(18 + round(4 * t), 21 + round(8 * t), 29 + round(30 * t), 255))
    img.alpha_composite(reduzir(logo, 440), (70, 95))
    img.alpha_composite(text_image(NOME, "#070a12", scale=20), (586, 198))  # sombra fina (a do pixelart escala junto)
    img.alpha_composite(text_image(NOME, "#f4f1ea", scale=20), (580, 190))
    for i, linha in enumerate(["O escritório virtual", "dos seus agentes de IA"]):
        img.alpha_composite(text_image(linha, "#7cc8ff", scale=4, shadow="#070a12"), (586, 380 + i * 44))
    return img


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else BRAND / "kubo-1024.png"
    logo = mestre(src)
    if src != BRAND / "kubo-1024.png":
        reduzir(logo, 1024).save(BRAND / "kubo-1024.png", optimize=True)
    saidas = {
        "favicon-16.png": reduzir(logo, 16),
        "favicon-32.png": reduzir(logo, 32),
        "logo-mark.png": reduzir(logo, 32),
        "logo-mark@4x.png": reduzir(logo, 128),
        "logo-detailed.png": reduzir(logo, 86),
        "icon-192.png": reduzir(logo, 192),
        "icon-512.png": reduzir(logo, 512),
        # iPhone: ícone opaco (o sistema arredonda os cantos), com respiro em volta do círculo.
        "apple-touch-icon.png": reduzir(logo, 180, fundo=FUNDO, margem=0.06),
        "signage.png": signage(),
    }
    saidas["signage@4x.png"] = saidas["signage.png"].resize((256, 64), Image.NEAREST)
    for nome, img in saidas.items():
        img.save(BRAND / nome, optimize=True)
    og_image(logo).convert("RGB").save(BRAND.parent / "og-image.png", optimize=True)
    print(f"marca {NOME}: {len(saidas) + 1} arquivos em {BRAND.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
