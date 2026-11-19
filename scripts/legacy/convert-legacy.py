"""One-time conversion of the original single-file shop page into project assets.

Usage: python3 scripts/legacy/convert-legacy.py <path-to-original-index.html> <project-root>

Writes:
  <root>/views/index.template.html    page shell with {{PLACEHOLDERS}} and <!--GALLERY-->
  <root>/public/js/*.js               inline scripts moved out so a strict CSP can run them
  <root>/scripts/legacy/manifest.json product rows and image file names for the DB import
  <root>/scripts/legacy/images/*      raw image bytes decoded from data URIs (imported by the Node script)
Inline admin code from the original (client-side password and IndexedDB storage) is dropped on purpose.
"""
import base64, html, json, os, re, sys

src_path, root = sys.argv[1], sys.argv[2]
text = open(src_path, encoding="utf-8", errors="replace").read()
legacy = os.path.join(root, "scripts", "legacy")
images_dir = os.path.join(legacy, "images")
os.makedirs(images_dir, exist_ok=True)
os.makedirs(os.path.join(root, "public", "js"), exist_ok=True)

# ---- 1. Extract products from the gallery ------------------------------------------------
gal_start = text.find('<div class="gallery">')
gal_end = text.rfind("</figure>") + len("</figure>")
gallery_html = text[gal_start:gal_end]

def decode_data_uri(uri, name):
    m = re.match(r"data:(image/[a-z+]+);base64,(.+)", uri, re.S)
    if not m:
        return None
    mime, b64 = m.group(1), m.group(2)
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg"}.get(mime, "bin")
    path = os.path.join(images_dir, f"{name}.{ext}")
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    return os.path.basename(path)

products = []
for m in re.finditer(r"<figure([^>]*)>(.*?)</figure>", gallery_html, re.S):
    attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
    inner = m.group(2)
    num = int(attrs.get("data-id", "0"))
    cap_m = re.search(r"<figcaption>(.*?)</figcaption>", inner, re.S)
    caption_raw = cap_m.group(1) if cap_m else ""
    size_m = re.search(r'<b dir="ltr">\s*(\d+)\s*[×x]\s*(\d+)\s*</b>', caption_raw)
    name = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r'<b dir="ltr">.*?</b>', "", caption_raw, flags=re.S)))
    name = re.sub(r"\s+", " ", name).strip()
    img_m = re.search(r'<img[^>]*\ssrc="([^"]+)"', inner)
    alt = html.unescape(re.search(r'<img[^>]*\salt="([^"]*)"', inner).group(1)) if re.search(r'<img[^>]*\salt="', inner) else ""
    full = attrs.get("data-full") or (img_m.group(1) if img_m else "")
    extra = attrs.get("data-extra", "")
    full_name = decode_data_uri(full, f"tile-{num:02d}-main") if full.startswith("data:") else None
    extra_name = decode_data_uri(extra, f"tile-{num:02d}-extra") if extra.startswith("data:") else None
    products.append({
        "number": num,
        "name": name or alt or f"کاشی {num}",
        "description": html.unescape(attrs.get("data-full-alt", "") or alt),
        "width_cm": int(size_m.group(1)) if size_m else None,
        "height_cm": int(size_m.group(2)) if size_m else None,
        "main_image": full_name,
        "extra_image": extra_name,
        "legacy_id": attrs.get("id", ""),
    })

# ---- 2. Other images outside the gallery (logo, hero) --------------------------------------
outside = text[:gal_start] + text[gal_end:]
assets = []
for i, m in enumerate(re.finditer(r'data:image/[a-z+]+;base64,[A-Za-z0-9+/=]+', outside)):
    name = decode_data_uri(m.group(0), f"site-asset-{i + 1:02d}")
    if name:
        assets.append({"index": i + 1, "file": name})

# ---- 3. Template: strip gallery, data URIs, admin block and scripts ------------------------
shell = text[:gal_start] + '<div class="gallery"><!--GALLERY-->' + text[gal_end:]
shell = re.sub(r'<div id="adm".*?(?=<script)', "", shell, flags=re.S)  # admin dialog markup
scripts = list(re.finditer(r"<script>(.*?)</script>", shell, re.S))
script_names = {0: "lightbox.js", 1: "sticky-header.js", 3: "ask-link.js", 4: "gallery-filter.js", 5: "translations.js"}
for idx in sorted(script_names, reverse=True):
    if idx >= len(scripts):
        continue
    body = scripts[idx].group(1).strip()
    if idx == 2:
        continue
    with open(os.path.join(root, "public", "js", script_names[idx]), "w", encoding="utf-8") as f:
        f.write(body + "\n")
    shell = shell[: scripts[idx].start()] + f'<script src="/js/{script_names[idx]}" defer></script>' + shell[scripts[idx].end():]
# Drop the admin-only script (index 2) and any leftover inline scripts
shell = re.sub(r"<script>.*?</script>", "", shell, flags=re.S)
shell = re.sub(r"\s<script src=\"/js/[a-z-]+\.js\" defer></script>", lambda m: m.group(0), shell)

# Remaining data URIs (inline SVG placeholders etc.) are replaced by a neutral transparent pixel
shell = re.sub(r'data:image/[a-z+]+;base64,[A-Za-z0-9+/=]+', "/img/blank.gif", shell)
shell = re.sub(r"data:image/svg\+xml,[^\"')\s]+", "/img/blank.gif", shell)

# Contact details become placeholders the server fills from settings
shell = shell.replace("0750 425 1661", "{{PHONE_1}}").replace("0750 704 1661", "{{PHONE_2}}")
shell = shell.replace("9647504251661", "{{WA_NUMBER}}").replace("@kargay.barzan.shree", "{{TIKTOK}}")

os.makedirs(os.path.join(root, "views"), exist_ok=True)
with open(os.path.join(root, "views", "index.template.html"), "w", encoding="utf-8") as f:
    f.write(shell)

with open(os.path.join(legacy, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump({"products": products, "assets": assets}, f, ensure_ascii=False, indent=2)

print("products:", len(products), "with size:", sum(1 for p in products if p["width_cm"]),
      "with extra image:", sum(1 for p in products if p["extra_image"]),
      "without caption:", sum(1 for p in products if not p["name"] or p["name"].startswith("کاشی ")))
print("site assets:", len(assets))
print("template bytes:", len(shell), "placeholders:", sorted(set(re.findall(r"\{\{[A-Z_0-9]+\}\}", shell))))
print("scripts written:", sorted(os.listdir(os.path.join(root, "public", "js"))))
