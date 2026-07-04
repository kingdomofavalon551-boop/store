-- ═══════════════════════════════════════════════════════════════════
-- SQL INIT DATABASE — Hanun Store
-- Jalankan SEKALI di Supabase SQL Editor untuk database BARU (kosong).
-- Membuat semua tabel dari nol. Idempoten (aman dijalankan ulang).
--
-- Urutan: buat tabel dulu (ini), BARU jalankan SQL_MIGRATION_FITUR_BARU.sql
-- (yang ADD COLUMN) tidak perlu lagi — semua kolomnya sudah termasuk di sini.
-- ═══════════════════════════════════════════════════════════════════

-- 1. products (master produk / matriks link) — dipakai Prisma (prisma.product)
CREATE TABLE IF NOT EXISTS products (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  accent  TEXT,
  dim1    JSONB,
  dim2    JSONB,
  cells   JSONB
);

-- 2. product_cells (sel matriks URL Drive) — FK ke products
CREATE TABLE IF NOT EXISTS product_cells (
  id         SERIAL PRIMARY KEY,
  product_id VARCHAR(50)  NOT NULL,
  row_tag    VARCHAR(100) NOT NULL,
  col_tag    VARCHAR(100) NOT NULL,
  url        TEXT NOT NULL,
  CONSTRAINT product_cells_product_row_col_unique UNIQUE (product_id, row_tag, col_tag),
  CONSTRAINT product_cells_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 3. shopee_orders (pesanan Shopee dari webhook GAS) — dipakai Prisma
CREATE TABLE IF NOT EXISTS shopee_orders (
  no_pesanan       TEXT PRIMARY KEY,
  id_transaksi     TEXT NOT NULL DEFAULT 'Menunggu Info',
  waktu            TIMESTAMPTZ NOT NULL DEFAULT now(),
  username_pembeli TEXT NOT NULL,
  status_aksi      TEXT NOT NULL,
  nominal          INTEGER NOT NULL DEFAULT 0,
  detail_produk    TEXT NOT NULL,
  subjek_email     TEXT
);

-- 4. system_logs — dipakai Prisma
CREATE TABLE IF NOT EXISTS system_logs (
  id        SERIAL PRIMARY KEY,
  timestamp TIMESTAMP(6) DEFAULT now(),
  level     VARCHAR(20),
  message   TEXT
);

-- 5. catalog_products (produk etalase) — dipakai via raw SQL di publicRoutes.js
CREATE TABLE IF NOT EXISTS catalog_products (
  id             SERIAL PRIMARY KEY,
  nama           TEXT NOT NULL,
  foto_url       TEXT NOT NULL,
  link_co        TEXT,
  harga          INTEGER DEFAULT 0,
  deskripsi      TEXT,
  variasi_config JSONB DEFAULT '[]',
  link_contoh    TEXT,
  urutan         INTEGER DEFAULT 0,
  aktif          BOOLEAN DEFAULT true,
  stok_habis     JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- 6. midtrans_orders (pesanan web via Midtrans) — dipakai via raw SQL
CREATE TABLE IF NOT EXISTS midtrans_orders (
  id             TEXT PRIMARY KEY,          -- format PD-<timestamp>-<random>
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_wa    TEXT NOT NULL,
  items          JSONB NOT NULL,
  total          INTEGER NOT NULL,
  status         TEXT NOT NULL,             -- pending|paid|settlement|capture|cancel|deny|expire|fraud
  referral_data  JSONB DEFAULT NULL,
  snap_token     TEXT,
  link_produk    JSONB,
  midtrans_data  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ
);

-- 7. referral_codes (kode diskon) — dipakai via raw SQL
CREATE TABLE IF NOT EXISTS referral_codes (
  id              SERIAL PRIMARY KEY,
  kode            TEXT UNIQUE NOT NULL,
  tipe_diskon     TEXT NOT NULL CHECK (tipe_diskon IN ('persen', 'nominal')),
  nilai_diskon    INTEGER NOT NULL,
  maks_pemakaian  INTEGER NOT NULL DEFAULT 1,
  jumlah_terpakai INTEGER NOT NULL DEFAULT 0,
  aktif           BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_kode ON referral_codes(kode);

-- 8. app_settings (key-value; dipakai untuk toggle mode maintenance)
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed baris maintenance (default: semua fitur normal, bukan maintenance)
INSERT INTO app_settings (key, value)
VALUES ('maintenance', '{"cari":false,"beli":false}')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Selesai. Verifikasi cepat (opsional):
--   SELECT table_name FROM information_schema.tables WHERE table_schema='public';
-- ═══════════════════════════════════════════════════════════════════
