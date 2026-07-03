# CLAUDE.md — hanun-store-catalog

Dokumen ini berisi konteks lengkap proyek **hanun-store-catalog** untuk membantu AI assistant (Claude) memahami arsitektur, konvensi, dan keputusan teknis yang sudah dibuat.

---

## 🗂️ Gambaran Proyek

**Hanun Store** adalah toko digital yang menjual perangkat ajar (Modul Ajar, PPT, KKTP, ATP, Prota, Promes) untuk guru Indonesia. Produk berupa file Google Drive yang dikirim otomatis setelah pembayaran.

**Repository ini** (`hanun-store-catalog`) adalah **frontend statis** yang di-deploy ke Vercel dan dapat diakses di `https://ganti-domain-toko-anda.com`.

Ada **repository terpisah** bernama `hanun-store-backend` yang di-deploy di `https://GANTI-URL-BACKEND-ANDA.vercel.app` — frontend ini mengakses semua data melalui API backend tersebut.

---

## 🏗️ Arsitektur Sistem

```
hanun-store-catalog (repo ini)        hanun-store-backend (repo terpisah)
├── Frontend statis (HTML/CSS/JS)  →   ├── Express.js + Prisma
├── Di-deploy ke Vercel                ├── Database: Supabase (PostgreSQL)
└── Domain: ganti-domain-toko-anda.com            ├── Di-deploy ke Vercel
                                       └── URL: GANTI-URL-BACKEND-ANDA.vercel.app
```

### Flow Utama

**Pesanan Shopee (sistem lama):**
```
Shopee → Google Apps Script → Webhook → hanun-store-backend
       → Telegram Bot admin → kirim email + WA ke pembeli
       → Pembeli cek link di index.html (input nomor pesanan Shopee)
```

**Pesanan Website Midtrans (sistem baru):**
```
Pembeli pilih produk → cart → checkout → Midtrans Snap popup
→ Webhook Midtrans → hanun-store-backend
→ bedahDanCariLink() → kirim email + WA + notif Telegram otomatis
→ Pembeli lihat link di success.html
```

**Mode Maintenance (toggle admin, tanpa redeploy):**
```
Admin nyalain switch di admin.html → PUT /api/public/maintenance
→ disimpan di tabel app_settings (key='maintenance')

Dicek di 2 titik, masing-masing independen:
1. Tombol "Cari" di index.html   → GET /pesanan/:no_pesanan digate server-side
2. Tombol "Beli Sekarang" produk.html → cek GET /maintenance sebelum masuk cart
   (backstop) POST /midtrans/create-transaction digate server-side juga,
   jadi jalur cart.html → checkout.html manual pun tetap ketolak.

Kalau digate, pembeli diarahkan ke maintenance.html?fitur=cari|beli.
```

---

## 📁 Struktur File Frontend

```
hanun-store-catalog/
│
├── index.html          # Halaman utama: cek pesanan Shopee + grid katalog
├── produk.html         # Detail produk: foto, deskripsi (collapse), variasi, preview contoh, share, add to cart
├── cart.html           # Keranjang belanja
├── checkout.html       # Form pembeli + Midtrans Snap + input kode referral
├── success.html        # Halaman setelah bayar: tampilkan link / hubungi admin
├── pending.html        # Pembayaran tertunda: countdown 3 jam + tombol batalkan
│
├── admin.html          # Admin: kelola katalog produk (CRUD) + toggle mode maintenance
├── orders.html         # Admin: riwayat pesanan Midtrans + rekap keuangan + kirim link manual
├── referral.html       # Admin: kelola kode diskon referral
├── maintenance.html    # Halaman "sedang maintenance" -- tujuan redirect saat fitur cari/beli dimatikan admin
│
├── contact.html        # Halaman kontak (wajib Midtrans)
├── tnc.html            # Syarat & Ketentuan (wajib Midtrans)
├── refund.html         # Kebijakan pengembalian dana (wajib Midtrans)
│
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (PWA)
├── icon-192.png        # Ikon PWA 192x192
└── icon-512.png        # Ikon PWA 512x512
```

---

## 🧩 Interaksi `produk.html` (Halaman Detail)

Perilaku UX khusus di halaman detail produk (semua sudah live, ditambah 3 Juli 2026):

- **Share produk.** Tombol bulat mengambang di pojok kanan-atas foto (`.btn-share-float`).
  - Di HP (`navigator.share` + user-agent mobile) → langsung buka **native share sheet**.
  - Di desktop → modal `#modal-share` berisi WhatsApp / Facebook / Telegram / X + tombol **Salin Link** (`navigator.clipboard`, fallback `execCommand`).
  - URL yang dibagikan = `${API}/share/${produk.id}` (endpoint backend beropengraph), **bukan** `produk.html?id=...` langsung — supaya preview WA menampilkan thumbnail produk. Lihat endpoint `/share/:id`.
- **Deskripsi collapse.** Deskripsi **tersembunyi default**; muncul via tombol **"Baca Deskripsi Produk"** (`toggleDeskripsi()`, teks & chevron berubah saat dibuka). Kalau `deskripsi` kosong, tombol tidak dirender.
- **Scroll-ke-variasi.** Kalau pembeli klik **Beli Sekarang / Keranjang** tapi belum pilih semua variasi, `validasiVariasi()` **tidak lagi memunculkan modal** — ia memanggil `scrollKeVariasi()` (gulir mulus ke kartu variasi + flash highlight oranye) plus toast "Pilih dulu: ...". Markup modal variasi lama sudah dihapus (CSS `.modal-*` tetap dipakai modal share).

---

## 🔌 API Backend

**Base URL:** `https://GANTI-URL-BACKEND-ANDA.vercel.app/api/public`

Semua file frontend menggunakan konstanta:
```js
const API = 'https://GANTI-URL-BACKEND-ANDA.vercel.app/api/public';
```

### Endpoint Publik (tanpa auth)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/pesanan/:no_pesanan` | Cek link pesanan Shopee (rate-limited 10x/menit) |
| PATCH | `/pesanan/:no_pesanan/ambil` | Tandai pesanan TERKIRIM + notif Telegram |
| GET | `/katalog` | Daftar produk aktif untuk halaman publik |
| GET | `/katalog/:id` | Detail satu produk |
| GET | `/share/:id` | HTML dgn OG meta (og:image = foto produk) lalu redirect ke `produk.html?id=:id`. Dipakai tombol Share di `produk.html` supaya preview WA/FB/Telegram menampilkan thumbnail produk, bukan logo. Perlu karena crawler share tidak jalankan JS (produk.html shell kosong yang diisi via fetch). |
| POST | `/referral/validasi` | Validasi kode referral saat checkout |
| POST | `/midtrans/create-transaction` | Buat transaksi Midtrans |
| POST | `/midtrans/notification` | Webhook dari Midtrans (tidak dipanggil frontend) |
| GET | `/midtrans/order/:order_id` | Cek status & link pesanan Midtrans |
| POST | `/midtrans/order/:order_id/cancel` | Batalkan pesanan pending |
| POST | `/midtrans/order/:order_id/regenerate-token` | Buat ulang Snap token yang expired |
| GET | `/midtrans/config` | Ambil client key Midtrans |
| GET | `/maintenance` | Status mode maintenance saat ini `{cari,beli}` |

### Endpoint Admin (butuh header `x-admin-secret`)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/katalog/all` | Semua produk termasuk nonaktif |
| POST | `/katalog` | Tambah produk baru |
| PUT | `/katalog/:id` | Edit produk |
| DELETE | `/katalog/:id` | Hapus produk |
| GET | `/midtrans/orders` | Daftar semua pesanan (support filter) |
| GET | `/midtrans/rekap` | Rekap keuangan + grafik 30 hari + terlaris |
| POST | `/midtrans/kirim-link` | Kirim link manual ke email + WA pembeli |
| GET | `/referral` | Daftar kode referral |
| POST | `/referral` | Buat kode referral baru |
| PUT | `/referral/:id` | Edit kode referral |
| DELETE | `/referral/:id` | Hapus kode referral |
| PUT | `/maintenance` | Ubah mode maintenance `{cari,beli}` |

---

## 🗃️ Database (Supabase)

### Tabel yang relevan untuk frontend ini

**`catalog_products`** — produk katalog toko
```sql
id              SERIAL PRIMARY KEY
nama            TEXT NOT NULL
foto_url        TEXT NOT NULL          -- URL Cloudinary (bukan Google Drive)
link_co         TEXT                   -- opsional, link Shopee/Lynk.id
harga           INT DEFAULT 0
deskripsi       TEXT
variasi_config  JSONB DEFAULT '[]'     -- [{nama:"Mapel", opsi:["MTK","IPA"]}]
link_contoh     TEXT                   -- URL Google Drive untuk preview
stok_habis      JSONB DEFAULT '[]'     -- ["IPA-7", "MTK-9"] kombinasi yang habis
urutan          INT DEFAULT 0
aktif           BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
```

**`midtrans_orders`** — pesanan via website
```sql
id              TEXT PRIMARY KEY       -- format: PD-{timestamp}-{random}
customer_name   TEXT
customer_email  TEXT
customer_wa     TEXT
items           JSONB                  -- [{produk_id, nama, variasi, harga, qty}]
total           INT
status          TEXT                   -- pending/paid/cancel/expire/fraud
snap_token      TEXT
link_produk     JSONB                  -- [{label, url}] hasil bedahDanCariLink
referral_data   JSONB                  -- {kode, diskon, tipe, nilai} jika pakai referral
midtrans_data   JSONB                  -- raw response dari Midtrans
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

**`referral_codes`** — kode diskon
```sql
id              SERIAL PRIMARY KEY
kode            TEXT UNIQUE            -- selalu uppercase, tanpa spasi
tipe_diskon     TEXT                   -- 'persen' atau 'nominal'
nilai_diskon    INT
maks_pemakaian  INT
jumlah_terpakai INT DEFAULT 0
aktif           BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
```

**`app_settings`** — setting key-value generik (dipakai pertama kali untuk mode maintenance)
```sql
key             TEXT PRIMARY KEY       -- saat ini cuma 1 baris: 'maintenance'
value           JSONB                  -- {"cari":bool,"beli":bool}
updated_at      TIMESTAMPTZ
```

**`shopee_orders`** — pesanan Shopee (sistem lama, read-only dari frontend ini)
```
no_pesanan      TEXT (key)
detail_produk   TEXT    -- format: "PAG MTK Kelas 7 (https://drive...) | PAG IPA ..."
username_pembeli TEXT
status_aksi     TEXT    -- diupdate ke 'TERKIRIM' saat pembeli ambil link sendiri
```

---

## 🎨 Desain & Identitas Visual

**Brand:** Hanun Store — Perangkat Ajar Digital

**Palet Warna:**
```css
--navy:    #1B3A6B   /* warna utama, header, teks penting */
--navy2:   #2A4F8F   /* navy hover state */
--orange:  #E07B2A   /* aksen utama, CTA, highlight */
--orange2: #F5A040   /* orange lebih terang, subtitle */
--cream:   #F5EFE6   /* background halaman */
--cream2:  #EDE4D6   /* border, divider */
```

**Font:** `Plus Jakarta Sans` (Google Fonts) — weight 400/500/600/700/800

**Logo header (`.logo-box` & `.login-logo`):** `<img>` ke Cloudinary — `GANTI_DENGAN_URL_LOGO_ANDA` (diganti dari SVG inline pada commit `1d91078`, 2026-07-02). Berlaku di semua header (11 halaman publik+admin) dan layar login admin/orders/referral.

**Favicon (ikon tab browser):** `<link rel="icon" type="image/jpeg" href="...ruxq3l.jpg">` — logo Cloudinary yang **sama** dengan logo header, dipasang tepat setelah `<title>` di **semua 13 halaman HTML** (3 Juli 2026). Sebelumnya cuma `index.html` yang punya favicon (PNG lokal); baris `rel="icon"` PNG lama di `index.html` dihapus agar tidak menimpa. `apple-touch-icon` (home screen iOS) tetap `/icon-192.png`. Ikon PWA saat di-install (di `manifest.json`) **masih** `/icon-192.png` & `/icon-512.png` — terpisah dari favicon tab.

**Ikon:** SVG inline (tidak ada icon library eksternal) — kecuali logo header & favicon di atas

**PWA:** Semua halaman publik adalah PWA — bisa diinstall di HP sebagai aplikasi

---

## 🔐 Autentikasi Admin

- **Satu password** untuk semua halaman admin (`admin.html`, `orders.html`, `referral.html`)
- Password disimpan di environment variable backend: `ADMIN_SECRET`
- Frontend kirim sebagai header: `x-admin-secret: <password>`
- Session disimpan di `sessionStorage` browser (hilang saat tab ditutup)
- Tidak ada JWT atau sistem token — simpel intentional karena single-user

---

## 💳 Midtrans

- **Mode:** Production (`MIDTRANS_IS_PRODUCTION=true`)
- **Client Key:** `GANTI_DENGAN_MIDTRANS_CLIENT_KEY_ANDA` (hardcoded di `checkout.html`)
- **Snap.js:** Di-load dari `https://app.midtrans.com/snap/snap.js`
- **Webhook URL:** `https://GANTI-URL-BACKEND-ANDA.vercel.app/api/public/midtrans/notification`
- **Finish URL:** `https://ganti-domain-toko-anda.com/success.html`

---

## 🛒 State Management

Tidak ada state management library. Semua state disimpan di:

| Data | Lokasi | Key |
|------|--------|-----|
| Isi keranjang | `localStorage` | `pd_cart` |
| Order ID terakhir | `localStorage` | `pd_last_order` |
| WA pembeli terakhir | `localStorage` | `pd_customer_wa` |
| Session admin | `sessionStorage` | `pd_admin_secret` |

**Format `pd_cart`:**
```json
[{
  "key": "4-Matematika - 7",
  "produk_id": 4,
  "nama": "PAG SMA Deep Learning",
  "variasi": "Matematika - 7",
  "harga": 35000,
  "foto_url": "https://res.cloudinary.com/...",
  "qty": 1
}]
```

---

## ⚠️ Catatan Warisan dari Template Asal

Proyek ini adalah salinan dari template toko digital yang sudah matang (Hanun Store).
Semua bug yang pernah ditemukan di template asal (escaping `onclick`, field ke-reset
saat toggle status, urutan variasi, null-check harga 0, `ADMIN_SECRET` fail-closed,
webhook Midtrans proses-dulu-baru-balas-200, dll) **sudah dalam keadaan fixed** di
kode yang disalin ke sini — tidak perlu dikerjakan ulang. Riwayat commit lengkapnya
ada di repo asal, bukan di sini (repo ini belum punya histori git sendiri).

Yang **masih perlu tindakan Anda** khusus untuk toko ini (lihat juga file
`SETUP-TOKO-BARU.md` di root proyek):

- Webhook `/api/shopee-webhook` & `/api/telegram-webhook` tidak ada verifikasi
  signature secara default (opt-in via `GAS_WEBHOOK_SECRET` / `TELEGRAM_WEBHOOK_SECRET`).
  Kalau mau dipakai, **wajib** disetel di kedua sisi (env var backend **dan**
  skrip pengirim) — kalau cuma satu sisi, webhook diam-diam ditolak.
- `prisma/schema.prisma` tidak mendeklarasikan tabel `catalog_products`,
  `midtrans_orders`, `referral_codes` (diakses via `$queryRaw`, aman dari SQL
  injection tapi tanpa type-safety). Bukan bug, cuma catatan desain.

---

## 📦 Environment Variables Backend

Set di Vercel Dashboard → hanun-store-backend → Settings → Environment Variables:

```
DATABASE_URL          = postgresql://... (Supabase connection string)
ADMIN_SECRET          = <password admin>
MIDTRANS_SERVER_KEY   = <server key Midtrans, JANGAN pernah ditulis plaintext di sini>
MIDTRANS_CLIENT_KEY   = GANTI_DENGAN_MIDTRANS_CLIENT_KEY_ANDA
MIDTRANS_IS_PRODUCTION= true
FRONTEND_URL          = https://ganti-domain-toko-anda.com
EMAIL_USER            = email@ganti-toko-anda.com
EMAIL_PASS            = <app password Gmail>
FONNTE_TOKEN          = <token Fonnte untuk kirim WA>
TELEGRAM_TOKEN        = <token bot Telegram>
TELEGRAM_CHAT_ID      = <chat ID admin>
```

---

## 🚀 Deploy

**Frontend (repo ini):**
- Auto-deploy via Vercel setiap push ke `main`
- Tidak ada build step — file statis langsung di-serve
- Domain custom: `ganti-domain-toko-anda.com`

**Backend (repo terpisah):**
- Auto-deploy via Vercel setiap push ke `main`
- Setelah tambah dependency baru, wajib commit `package.json` + `package-lock.json`
- Prisma: generate otomatis via `postinstall` script

---

## 🔧 SQL Migrations

Semua migration dijalankan manual di **Supabase SQL Editor**. Tidak ada migration tool otomatis.

File migration tersedia di: `SQL_MIGRATION_FITUR_BARU.sql`

```sql
-- Kolom yang sudah ditambahkan ke catalog_products:
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS deskripsi TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS harga INT DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS variasi_config JSONB DEFAULT '[]';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS link_contoh TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS stok_habis JSONB DEFAULT '[]';

-- Tabel baru:
-- midtrans_orders (lihat schema di atas)
-- referral_codes (lihat schema di atas)
```

---

## 📋 Konvensi Kode

### Escaping di template string HTML

```js
// Untuk konten HTML (aman dari XSS):
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Untuk nilai di dalam atribut onclick='...' (escape kutip tunggal):
function escA(s){ return String(s||'').replace(/'/g,"\\'"); }

// JANGAN sisipkan JSON.stringify() langsung ke onclick="" tanpa escaping penuh
// BENAR:
onclick="bukaEdit(${JSON.stringify(p).replace(/"/g,'&quot;')})"
// SALAH:
onclick="bukaEdit(${JSON.stringify(p)})"
```

### Format harga

```js
// Selalu gunakan toLocaleString('id-ID') untuk display:
Rp ${parseInt(harga).toLocaleString('id-ID')}

// Cek harga dengan null check, bukan falsy (karena 0 valid):
p.harga !== null && p.harga !== undefined ? `Rp ${p.harga}` : 'Hubungi Admin'
```

### Format variasi kombinasi stok habis

Admin input di field "Stok Habis": `IPA-7, Matematika-9`
Disimpan di DB sebagai: `["IPA-7", "Matematika-9"]`
Kunci kombinasi dibuat dari: nilai variasi diurutkan sesuai `variasi_config`, digabung dengan `-`

---

## 📞 Kontak Admin

- **WhatsApp:** `GANTI_NOMOR_WA_ADMIN` — placeholder, hardcoded di beberapa file (lihat `SETUP-TOKO-BARU.md` di root untuk daftar lengkap)
- **Email:** `email@ganti-toko-anda.com` — placeholder di `contact.html` & `tnc.html`
- **Toko Shopee:** `https://shopee.co.id/GANTI_NAMA_TOKO_SHOPEE` — placeholder, ditampilkan di kartu "Informasi Toko" `contact.html`
- **Template WA admin (link belum ada):**
  ```
  Halo min, saya belum mendapatkan pesanan saya
  no pesanan: XXXXXXX
  produk: PAG Matematika Kelas 7
  ```
