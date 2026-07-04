# Setup Hanun Store — Checklist

Folder ini adalah **salinan** dari struktur PenaDigital (backend + dashboard admin +
storefront), dengan brand/URL/kontak yang sudah diganti jadi placeholder generik.
Kode & alur logika **sama persis** dengan PenaDigital (modul ajar guru) — cuma
identitas toko yang perlu Anda isi sendiri, plus beberapa hal yang tidak bisa saya
jalankan dari sini (akun eksternal, GAS, deploy ke akun Vercel Anda).

Struktur:
```
hanun-store/
├── backend/hanun-store-backend/     → deploy sebagai project Vercel terpisah (Node/Express)
├── frontend/hanun-store-frontend/   → deploy sebagai project Vercel terpisah (dashboard admin)
├── catalog/hanun-store-catalog/     → deploy sebagai project Vercel terpisah (storefront pelanggan)
└── files/SQL_MIGRATION_FITUR_BARU.sql
```

Tidak ada `.git` di masing-masing folder (sengaja) — silakan `git init` &
hubungkan ke repo GitHub Anda sendiri kapan pun siap.

---

## 1. Yang HARUS Anda kerjakan di luar kode (tidak bisa saya lakukan)

- [ ] Buat project **Supabase** baru (database Postgres) untuk toko ini.
- [ ] Jalankan migrasi tabel dasar (via Prisma `migrate` atau SQL manual) **dan**
      `files/SQL_MIGRATION_FITUR_BARU.sql` di Supabase SQL Editor.
- [ ] Buat akun/app baru untuk: **Midtrans** (server key + client key produksi),
      **Gmail** (App Password untuk `EMAIL_USER`/`EMAIL_PASS`), **Fonnte** (token WA),
      **Telegram Bot** (token + chat ID admin).
- [ ] Buat **Google Apps Script** baru untuk parse email pesanan Shopee toko ini
      (kalau toko ini juga jualan di Shopee) dan arahkan `POST` ke
      `https://<domain-backend-baru-anda>/api/shopee-webhook`. Format payload yang
      diharapkan backend ada di `backend/hanun-store-backend/src/controllers/shopeeController.js`
      (cari `shopee-webhook` di `src/routes/api.js`).
- [ ] Daftarkan webhook Telegram bot ke `https://<domain-backend>/api/telegram-webhook`.
- [ ] Buat **3 project Vercel terpisah** di akun Vercel Anda, masing-masing arahkan
      ke folder `backend/hanun-store-backend`, `frontend/hanun-store-frontend`,
      `catalog/hanun-store-catalog` (biasanya via push ke 3 repo GitHub terpisah,
      lalu import di Vercel — lihat `frontend/hanun-store-frontend/README.md` untuk
      langkah detail versi dashboard admin).
- [ ] Set semua **environment variables** di tiap project Vercel (daftar lengkap
      di bawah).
- [ ] (Opsional tapi disarankan) Hubungkan domain custom untuk storefront.

---

## 2. Placeholder yang WAJIB diganti sebelum go-live

Saya sudah ganti semua identitas PenaDigital jadi placeholder yang jelas dan
mudah dicari (case-sensitive, coba "Find in Files" di editor Anda):

| Placeholder | Ganti dengan | Ada di |
|---|---|---|
| `Hanun Store` | Nama toko Anda | Judul halaman, manifest.json, footer, teks email/WA (semua file HTML+JS) |
| `hanun-store-backend.vercel.app` | Domain project backend Vercel Anda | `const API=...` di semua HTML dashboard admin & storefront |
| `hanun-store-catalog.vercel.app` | Domain custom storefront Anda | fallback `FRONTEND_URL` di `publicRoutes.js` |
| `email@ganti-toko-anda.com` | Email toko Anda | `contact.html`, `tnc.html` |
| `GANTI_NOMOR_WA_ADMIN` / `GANTI-NOMOR-WA-ADMIN` | Nomor WA admin (format `62...` utk link `wa.me`, format `08xx-xxxx-xxxx` utk teks tampilan) | `publicRoutes.js`, `shopeeController.js`, banyak file di `catalog/` |
| `GANTI_NAMA_TOKO_SHOPEE` | Username toko Shopee Anda | `contact.html` |
| `GANTI_DENGAN_URL_LOGO_ANDA` | URL logo Anda (upload ke Cloudinary/host lain) | header + favicon di semua halaman `catalog/` |
| `GANTI_DENGAN_MIDTRANS_CLIENT_KEY_ANDA` | Client key Midtrans **produksi** Anda | `checkout.html`, `pending.html` (script `snap.js`) |

**Penting:** kunci Midtrans di frontend cuma **client key** (memang publik by
design). **Server key** JANGAN pernah taruh di file — hanya di environment
variable `MIDTRANS_SERVER_KEY` di Vercel.

Setelah ganti `Hanun Store` jadi nama asli, ingat juga:
- Bump `CACHE` di `frontend/hanun-store-frontend/sw.js` dan
  `catalog/hanun-store-catalog/sw.js` (sekarang `hanun-store-v1`) setiap kali file
  di-edit lagi setelah deploy pertama, supaya PWA tidak menyajikan versi lama.
- Ganti `icon-192.png` / `icon-512.png` di kedua folder dengan ikon toko Anda.

---

## 3. Environment Variables — Backend (Vercel project `hanun-store-backend`)

```
DATABASE_URL          = <connection string Supabase>
DIRECT_URL            = <connection string Supabase, non-pooling>
ADMIN_SECRET           = <buat password admin BARU yang unik untuk toko ini>
MIDTRANS_SERVER_KEY    = <server key Midtrans produksi>
MIDTRANS_CLIENT_KEY    = <client key Midtrans produksi>
MIDTRANS_IS_PRODUCTION = true
FRONTEND_URL           = https://<domain-storefront-anda>
EMAIL_USER             = <email gmail toko>
EMAIL_PASS             = <App Password Gmail, bukan password login biasa>
FONNTE_TOKEN           = <token Fonnte>
TELEGRAM_TOKEN         = <token bot Telegram>
TELEGRAM_CHAT_ID       = <chat id admin>
```

Opsional (biarkan **kosong/tidak di-set** kalau GAS/Telegram webhook Anda belum
kirim header secret — kalau di-set tapi pengirim tidak cocok, webhook akan
diam-diam ditolak):
```
ALLOWED_ORIGINS
GAS_WEBHOOK_SECRET
TELEGRAM_WEBHOOK_SECRET
```

`ADMIN_SECRET` dipakai bersama oleh dashboard admin (`frontend/`) dan halaman
admin storefront (`catalog/.../admin.html`, `orders.html`, `referral.html`) —
harus sama persis di ketiganya (mereka kirim via header `x-admin-secret`, tidak
lewat env var sendiri di sisi frontend karena statis).

---

## 4. Alur kerja edit selanjutnya

Sama seperti proyek asal (lihat `catalog/hanun-store-catalog/CLAUDE.md` untuk
detail storefront): edit file → `node --check` untuk validasi sintaks JS →
commit ke masing-masing repo (3 repo terpisah) → push `main` → Vercel
auto-deploy. Migrasi DB baru ditulis manual sebagai SQL dan dijalankan sendiri
di Supabase.
