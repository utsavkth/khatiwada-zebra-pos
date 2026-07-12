# Khatiwada Store — Zebra POS (v2)

A NEW, purpose-built cashier app for a Zebra TC53 handheld barcode scanner,
built as a successor/companion to the existing "Nepal Grocery POS" project.
This is a SEPARATE codebase/repo, but shares the SAME live database as the
original app. Owner: Utsav (Sydney). Users: family members in the shop
(Kathmandu, Nepal).

IMPORTANT: the original POS ("Nepal Grocery POS" / "Khatiwada Store" v1)
stays live and untouched for daily use while this is developed. Do not
modify the original repo. This is a parked/experimental build until proven.

## Relationship to the original app — read this first

1. SAME database: this app reads and writes the exact same `store.db` and
   `sales.db` SQLite files as the original app (mounted from the same
   location on the Pi's HDD: `Docker-Data/nepal-pos/`). Both apps run as
   separate Docker containers but share this data via the same volume
   mount — there is only ONE product catalog and ONE sales history, used
   by both apps.
2. SQLite concurrency: since two separate processes/containers will read
   and write the same database files, enable WAL (Write-Ahead Logging)
   mode on both databases and use careful connection handling (short-lived
   connections, retry-on-lock where sensible) to avoid "database is
   locked" errors. This matters more here than it did for the original
   single-app setup.
3. Starting point: copy the original app's `db.py`, admin routes/templates,
   auth (hashed password in the `settings` table), reports, and CSV
   import/export as the base for this new repo — that code is already
   proven and matches the shared schema exactly. Don't rebuild it from
   scratch. Then REPLACE the cashier UI with the new Zebra-optimized one
   described below, and ADD the new features (named carts, live sync,
   Fonepay) on top.
4. This app has ITS OWN admin portal (not shared UI with the original,
   even though the data is shared) — confirmed decision, not an oversight.

## Confirmed decisions

1. Stack: same as the original — Python + Flask + SQLite + plain
   HTML/CSS/JavaScript. No native Android app, no APK. Everything is
   browser-based (Chrome on the Zebra), same as the original project.
2. Primary hardware: Zebra TC53 (Android 11, upgraded to 13, supported
   through Android 16 — comfortably clears Tailscale's Android 8.0+
   minimum). NOT the older TC56 originally considered (rejected: sits
   right at the Android version floor with no headroom, secondhand units
   inconsistent on whether they've been OTA-upgraded to 8.1 at all).
   Ordered 2026-07-04, secondhand via Cash Converters Australia (~$369
   AUD, 90-day warranty). CONFIRMED EXACT SPECS: 6" FHD+ display, 1080 x
   2160 pixels PORTRAIT, Gorilla Glass, 600 nits brightness (bright
   enough for a shop with windows/sunlight); physical size ~6.5" tall x
   3.0" wide x 0.66" thick, held one-handed; Qualcomm 6490 octa-core
   processor; scan engine is either SE4720 (standard range) or SE55
   Advanced Range with IntelliFocus — confirm which the purchased unit
   has once it arrives; 16MP camera; Wi-Fi 6E, Bluetooth 5.2; IP68/IP65
   sealed. UI DESIGN TARGET: design for a 1080x2160 portrait viewport
   (~1:2 aspect ratio) — tall and narrow, NOT landscape, NOT a stretched
   version of the original app's layout. Edge-to-edge screen, minimal
   wasted margin expected. Touch targets sized for one-handed operation
   at 6" diagonal. CONFIRMED WORKING at Bunnings (2026-07-12): scanning
   a barcode into Chrome's address bar/a text field populated it
   correctly, validating DataWedge keyboard-wedge on this exact
   model/Android version on real hardware, not just theory.
3. Barcode scanning: via DataWedge "keyboard wedge" mode, Zebra's built-in
   scanner configured to type scanned barcodes directly into the browser's
   currently-focused text field, exactly like a keyboard, followed by
   Enter. This is configured on the DEVICE (DataWedge profile), not in
   app code. The app must never try to access the camera or implement its
   own scanning — treat all barcode input as if it were typed/pasted text
   arriving in a focused input field.

   SCAN-TO-LOOKUP BEHAVIOR MUST MATCH THE ORIGINAL APP EXACTLY: an Enter
   keypress on the barcode input field triggers the same lookup-and-decide
   logic already proven in the original app's camera scan flow — if the
   barcode matches an existing product, auto-add it to the current
   cart/bill; if not found, Quick Add auto-opens immediately (same
   auto-open-on-miss behavior as the original app). Reuse this existing
   logic/endpoint rather than rebuilding it — the only genuinely new piece
   is listening for the Enter keypress on a focused barcode field and
   treating it identically to a successful camera scan event.

   WEIGHED ITEM REFINEMENT: if a scanned barcode matches a product where
   is_weighed is true, do NOT auto-add at a flat price — open the weight
   pad (the same one used by the category tap-through picker) so staff
   can enter the actual kg amount before it's added to the cart. This
   supports Utsav's plan to print barcode labels for each weighed variety
   (e.g. a code like "WT-RICE-BASMATI") and stick them on shelf bins, so
   staff can scan the shelf label as a faster alternative to tapping
   through the category → variety picker. BOTH paths (scan a shelf label,
   or tap through category → variety) must lead to the exact same weight
   pad — scanning is an additional fast path, not a replacement for
   manual navigation, which must keep working exactly as it does today.
4. Secondary hardware: existing Lenovo Chromebook Duet, repurposed as the
   "register/customer display" — shows the live-synced cart as items are
   scanned on the Zebra. This is a SEPARATE browser session/view of the
   same live sale, not a duplicate cashier.
5. NEW cashier UI: purpose-built for the Zebra TC53's ~6" handheld
   screen and one-handed workflow. Do not just reuse the original app's
   responsive CSS stretched to fit — design fresh for this device and
   this specific workflow (scan-heavy, one-handed, walking the shop floor
   potentially, not fixed at a counter).
6. Named/saved carts, server-side persisted: scanning items builds a cart
   saved under a name (e.g. a customer name or a simple session label),
   written to the database as each item is scanned — NOT held only in
   browser JavaScript memory. Must survive a device restart or browser
   crash without losing the cart. Both the Zebra and the Chromebook
   register view read/write this same server-side cart state.
7. Live sync: WebSockets (Flask-SocketIO) push updates between the Zebra
   and the Chromebook register view in real time — an item scanned on the
   Zebra appears instantly on the Chromebook, and a payment confirmation
   (see below) updates both screens live too.
8. Fonepay QR payment (BLOCKED — see Open blocker below): once unblocked,
   the Zebra displays a Fonepay QR code for the current cart's total;
   customer scans and pays with their own banking app; Fonepay sends a
   webhook to the Flask server on payment completion; the server pushes
   that confirmation to whichever screen(s) are watching that sale via
   the same WebSocket connection. No native push notifications — this is
   a browser page reacting to a live update, same mechanism as the cart
   sync above.
9. Currency: Rs. (NPR), formatted as `Rs. 1,250.00` — same as the
   original app.
10. Timezone: Asia/Kathmandu for all sale timestamps — same as the
    original app.
11. No native Android app / APK — confirmed multiple times, do not
    reconsider this without explicit instruction.

## Open blocker (not code — do not attempt to build around this)

Fonepay QR payment (decision 8) requires genuine Fonepay MERCHANT API
credentials (merchant code + secret key) from the shop's bank — this is
DIFFERENT from just having a Fonepay QR code for manual/visual-confirm
payments (which the shop already has and uses today). Utsav needs to
confirm with his parents/bank whether API access exists before this
feature can be built or tested. Until resolved: build and test everything
else (scanning, named carts, live sync, admin portal) using the SAME
manual QR + visual confirmation approach the original app already uses —
do not attempt to fake or stub Fonepay's API without real credentials.

## Deferred to a future project (do not build)

1. A dedicated customer-facing screen (separate monitor/TV + mini-PC or
   Android TV box) — the Chromebook fills this role for now, a dedicated
   screen is a possible future upgrade, not part of this build.
2. SMS receipts to a customer's phone number — undecided, not part of
   this build. Email receipts (see the original app's backlog) may or may
   not extend to this app — not yet decided, ask before building.

## Database schema

Identical to the original app (Nepal Grocery POS) — see that project's
CLAUDE.md for full schema. Key tables: `products` (store.db),
`sales`/`sale_items` (sales.db), `settings` (store.db, holds hashed admin
password). This app adds one new concept: named/saved carts — design a
new table (e.g. `carts` with columns for a name/label, status
open/completed, created timestamp) and a `cart_items` table mirroring
`sale_items` structure, so an in-progress cart can be built up over time
and then converted into a real `sales`/`sale_items` record once payment
completes and the cart closes.

## Infrastructure (Pi deployment — not yet done)

Separate Docker container from the original app, needs its own host port
(check what's free — the original app uses 5050 internally, :8443 via
Caddy externally; 13+ other containers already run on this Pi, verify
before assigning a port). Mounts the SAME volume as the original app:
`Docker-Data/nepal-pos` → wherever this app expects its data path, so
both containers see the same `store.db`/`sales.db` files. Will need its
own Caddy site block for HTTPS access once ready to deploy (same
Tailscale cert can likely be reused, same pattern as the original app's
`:8443` Caddy block — see the original CLAUDE.md decision 4 for the
cert/domain details).

## Project structure

- `app.py` — all Flask routes (root `/` is the Zebra cashier; `/admin` is this
  app's own copy of the proven admin portal; same JSON APIs as the original)
- `db.py` — database helpers copied from the original, plus WAL mode + busy
  timeout on every connection (shared-database concurrency, see above)
- `nepali_date.py` — Bikram Sambat conversion for the admin reports
- `templates/zebra.html`, `static/zebra.js`, `static/zebra.css` — the Zebra
  cashier UI (always-focused `#wedge-input`, payment step, saved carts);
  `zebra.css` loads after `style.css` and reuses its components
- `templates/admin_*.html`, `static/admin.css`, `static/admin-products.js` —
  the admin portal (copied, unchanged)
- `static/fonepay-static-qr.jpg` — the shop's REAL static Fonepay QR
  (terminal 2222150006683313), cropped from the official Fonepay PDF; shown on
  the payment step. `renderPaymentQr(saleTotal)` in `static/zebra.js` is the
  single marked swap point (`TODO(fonepay-dynamic-qr)`) for the blocked
  Dynamic QR API.
- `Dockerfile` / `docker-compose.yml` — own container `zebra-pos`, host port
  5051 (VERIFY free on the Pi before first deploy), SAME data volume as the
  original app
- `tests.py` — full scenario suite adapted from the original (`python
  tests.py`, throwaway temp database)

## Build phases (draft)

1. ✅ Set up new repo, copy proven code (db.py, admin, auth, reports,
   CSV import/export) from the original app as a starting base (2026-07-13)
2. ✅ Add WAL mode + careful connection handling for shared-database
   concurrent access (2026-07-13 — WAL + 5s busy timeout on every connection)
3. ✅ Build the new Zebra-optimized cashier UI (scan-driven, one-handed,
   ~6" screen) (2026-07-13 — includes the payment step in its allowed
   manual-confirmation form: real static Fonepay QR + PAYMENT RECEIVED tap)
4. Build named/saved carts with server-side persistence (an INTERIM
   localStorage save/park-cart exists on the cashier meanwhile — device-local
   only, to be replaced by this phase, flagged not silent)
5. Build WebSocket live sync between Zebra cashier view and Chromebook
   register view
6. ✅ Test locally (can be done before the physical Zebra arrives — use
   browser dev tools to simulate the screen size, and simulate barcode
   scans by typing + Enter into the focused field, exactly matching what
   DataWedge will do) (2026-07-13 — full suite passing + simulated-scan
   browser verification at handheld viewport)
7. Test on the real Zebra TC53 once purchased and configured (DataWedge
   profile setup is a device-side task, not app code)
8. Once Fonepay API access is confirmed: build QR generation + webhook
   payment confirmation (the static-QR payment step and its swap point are
   already in place — only the dynamic half is blocked)
9. Full end-to-end testing in Sydney before shipping the Zebra to Nepal
10. Deploy to the Pi, test over Tailscale, decide when/how to cut over
    from the original app

Always check this file before making architectural choices. If a request
conflicts with a confirmed decision above, flag it instead of silently
changing the approach.
