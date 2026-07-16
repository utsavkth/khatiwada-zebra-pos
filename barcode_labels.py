"""Shelf-label barcodes for weighed products (CLAUDE.md decision 3): printed
Code128 labels staff stick on shelf bins as a faster alternative to the
category -> variety tap-through picker. The scan-side lookup already treats
any space-free scanned value as an exact-barcode candidate first
(zebra.js handleWedgeEnter) and opens the weight pad on a weighed match — this
module only produces the code strings and the printable barcode graphic for
the admin "Print labels" page.

Codes are restricted to CODE_CHARS (see app.py's validation) so every
generated/edited code is guaranteed renderable here without a fallback path.
"""
import io
import re

import barcode as _barcode
from barcode.writer import SVGWriter


def suggest_code(name, existing_codes):
    """A readable, unique shelf-label code from a product name, e.g.
    "Basmati Rice" -> "WT-BASMATI-RICE". existing_codes is the set of codes
    already spoken for (in the DB, or suggested earlier in this same request)
    — mutated in place so repeated calls never collide with each other."""
    slug = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug) or "ITEM"
    base = f"WT-{slug}"[:40]
    code = base
    n = 2
    while code in existing_codes:
        code = f"{base}-{n}"
        n += 1
    existing_codes.add(code)
    return code


def render_svg(code):
    """An inline, embeddable Code128 SVG for `code`, bars only — the template
    renders the code as its own HTML text under the bars so its styling
    matches the rest of the label instead of relying on the SVG's font."""
    bc = _barcode.get("code128", code, writer=SVGWriter())
    buf = io.BytesIO()
    bc.write(buf, options={
        "module_height": 14.0,
        "module_width": 0.34,
        "quiet_zone": 3.0,
        "write_text": False,
    })
    return buf.getvalue().decode("utf-8")
