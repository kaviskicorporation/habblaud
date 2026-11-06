"""Fork Kaviski (KAVISKI.md): gera a marca Voxtrin (https://voxtrin.com) a partir das duas imagens mestre do site.

Entradas: os arquivos oficiais do Voxtrin (PNG com alfa), guardados como vieram em client/public/assets/brand/:
- voxtrin-icon.png / voxtrin-icon-space.png: o "V" (símbolo), justo e com margem;
- voxtrin-full.png / voxtrin-full-space.png: o logotipo inteiro (o "V" + "OXTRIN"), justo e com margem.
O favicon.ico oficial fica em client/public/favicon.ico (copiado como veio).
Saída: os arquivos de client/public/assets/brand/ que o original usa (favicon, ícones do app, mark do topo), o
logotipo do topo (wordmark.png), a placa da recepção (fonte bitmap do pixelart.py) e o og-image.

Uso (precisa de Pillow e numpy):
    python3 scripts/kaviski/marca.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "assets"))
from pixelart import draw_text, hex_rgba, text_width  # noqa: E402

NOME = "Voxtrin"
BRAND = ROOT / "client" / "public" / "assets" / "brand"
FUNDO = "#090909"  # o preto do site
VERMELHO = "#e22c3f"
FONTE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def recortar(img: Image.Image, quadrado: bool) -> Image.Image:
    """Recorta na caixa do alfa (ignora poeira quase transparente); `quadrado` centraliza num quadrado."""
    img = img.convert("RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
    img = img.crop(box)
    if not quadrado:
        return img
    lado = max(img.size)
    out = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    out.paste(img, ((lado - img.width) // 2, (lado - img.height) // 2))
    return out


def reduzir(img: Image.Image, size: int, fundo: str | None = None, margem: float = 0.0) -> Image.Image:
    inner = round(size * (1 - 2 * margem))
    small = img.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), hex_rgba(fundo) if fundo else (0, 0, 0, 0))
    out.alpha_composite(small, ((size - inner) // 2, (size - inner) // 2))
    return out


def altura(img: Image.Image, h: int) -> Image.Image:
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


def signage() -> Image.Image:
    """Placa da recepção, 64x16: chapa escura com bisel, parafusos e "Voxtrin" ("Vox" claro, "trin" vermelho)."""
    w, h = 64, 16
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    outline, top, face, bottom = hex_rgba("#121214"), hex_rgba("#3a3a40"), hex_rgba("#232327"), hex_rgba("#1a1a1d")
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
        px[sx, 7] = hex_rgba("#c9ccd3")
        px[sx, 8] = hex_rgba("#7d8089")
    a, b = NOME[:3], NOME[3:]
    tx, ty = (w - text_width(NOME)) // 2, 4
    bx = tx + text_width(a) + 1
    draw_text(img, tx, ty + 1, a, "#050506")
    draw_text(img, bx, ty + 1, b, "#050506")
    draw_text(img, tx, ty, a, "#eef0f4")
    draw_text(img, bx, ty, b, "#ff4a5c")
    return img


def og_image(mark: Image.Image, wordmark: Image.Image) -> Image.Image:
    """Prévia do link (1200x630): fundo preto com brilho vermelho, o logotipo do site e a frase."""
    w, h = 1200, 630
    img = Image.new("RGBA", (w, h), hex_rgba(FUNDO))
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((330, 60, 870, 470), fill=(226, 44, 63, 70))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(110)))
    logo = altura(wordmark, 190)
    img.alpha_composite(logo, ((w - logo.width) // 2, 150))
    d = ImageDraw.Draw(img)
    fonte = ImageFont.truetype(FONTE, 38)
    frase = "O escritório virtual dos seus agentes de IA"
    tw = d.textlength(frase, font=fonte)
    d.text(((w - tw) / 2, 420), frase, font=fonte, fill=(205, 208, 216, 255))
    d.rectangle(((w - 120) // 2, 490, (w + 120) // 2, 494), fill=hex_rgba(VERMELHO))
    return img


def main() -> None:
    mark = recortar(Image.open(BRAND / "voxtrin-icon.png"), quadrado=True)
    mark_space = Image.open(BRAND / "voxtrin-icon-space.png").convert("RGBA")
    word = recortar(Image.open(BRAND / "voxtrin-full.png"), quadrado=False)
    saidas = {
        "favicon-16.png": reduzir(mark, 16),
        "favicon-32.png": reduzir(mark, 32),
        "logo-mark.png": reduzir(mark, 32),
        "logo-mark@4x.png": reduzir(mark, 128),
        "logo-detailed.png": reduzir(mark, 86),
        # Ícones do app (e do TwiCC): o "V" com margem do arquivo oficial, sobre o preto do site.
        "icon-192.png": reduzir(mark_space, 192, fundo=FUNDO),
        "icon-512.png": reduzir(mark_space, 512, fundo=FUNDO),
        # iPhone: ícone opaco (o sistema arredonda os cantos).
        "apple-touch-icon.png": reduzir(mark_space, 180, fundo=FUNDO),
        # Logotipo do topo e da abertura: 3x da altura em que aparece (32 px), nítido em telas densas.
        "wordmark.png": altura(word, 96),
        "signage.png": signage(),
    }
    saidas["signage@4x.png"] = saidas["signage.png"].resize((256, 64), Image.NEAREST)
    for nome, img in saidas.items():
        img.save(BRAND / nome, optimize=True)
    og_image(mark, word).convert("RGB").save(BRAND.parent / "og-image.png", optimize=True)
    print(f"marca {NOME}: {len(saidas) + 1} arquivos em {BRAND.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
