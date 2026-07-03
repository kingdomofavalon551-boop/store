-- ═══════════════════════════════════════════════════════════════════
-- SQL MIGRATION — Jalankan di Supabase SQL Editor
-- Fitur: Stok Habis per Variasi, Cancel Order, Program Referral
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tambah kolom stok_habis di catalog_products
ALTER TABLE catalog_products
ADD COLUMN IF NOT EXISTS stok_habis JSONB DEFAULT '[]';

-- 2. Tambah kolom referral_data di midtrans_orders (untuk catat diskon yang dipakai)
ALTER TABLE midtrans_orders
ADD COLUMN IF NOT EXISTS referral_data JSONB DEFAULT NULL;

-- 3. Buat tabel referral_codes untuk program referral
CREATE TABLE IF NOT EXISTS referral_codes (
  id              SERIAL PRIMARY KEY,
  kode            TEXT UNIQUE NOT NULL,
  tipe_diskon     TEXT NOT NULL CHECK (tipe_diskon IN ('persen', 'nominal')),
  nilai_diskon    INT NOT NULL,
  maks_pemakaian  INT NOT NULL DEFAULT 1,
  jumlah_terpakai INT NOT NULL DEFAULT 0,
  aktif           BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index untuk pencarian kode lebih cepat
CREATE INDEX IF NOT EXISTS idx_referral_kode ON referral_codes(kode);

-- ═══════════════════════════════════════════════════════════════════
-- Fitur: Mode Maintenance (bisa di-toggle admin per fitur, tanpa redeploy)
-- ═══════════════════════════════════════════════════════════════════

-- 4. Tabel setting key-value generik
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Seed baris maintenance (default semua fitur aktif/normal, bukan maintenance)
INSERT INTO app_settings (key, value)
VALUES ('maintenance', '{"cari":false,"beli":false}')
ON CONFLICT (key) DO NOTHING;
