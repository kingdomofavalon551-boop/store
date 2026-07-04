// ═══════════════════════════════════════════════════════════════════
// FILE: src/routes/publicRoutes.js  (VERSI LENGKAP dengan Midtrans)
// Tambahkan ke src/server.js:
//   const publicRoutes = require('./routes/publicRoutes');
//   app.use('/api/public', publicRoutes);
//
// Install packages:
//   npm install midtrans-client nodemailer axios
//
// .env yang diperlukan:
//   DATABASE_URL, ADMIN_SECRET, FONNTE_TOKEN
//   EMAIL_USER, EMAIL_PASS
//   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
//   MIDTRANS_SERVER_KEY=Mid-server-_OdBDMdIbTUKnfbktlC4RaIf
//   MIDTRANS_CLIENT_KEY=GANTI_DENGAN_MIDTRANS_CLIENT_KEY_ANDA
//   MIDTRANS_IS_PRODUCTION=true
// ═══════════════════════════════════════════════════════════════════

const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const nodemailer = require('nodemailer');
const midtrans   = require('midtrans-client');

const { PrismaClient } = require('@prisma/client');
if (!globalThis._prismaPublic) globalThis._prismaPublic = new PrismaClient();
const prisma = globalThis._prismaPublic;

// Pakai pencari link "kuat" dari shopeeController (kamus alias mapel lengkap,
// angka romawi, pencocokan cell yang akurat) — menggantikan versi lokal lemah
// yang gagal untuk sebagian mapel. Dipakai webhook Midtrans & endpoint cari-link.
const { bedahDanCariLink } = require('../controllers/shopeeController');

// ── Midtrans client ──────────────────────────────────────────────
const snap = new midtrans.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey:    process.env.MIDTRANS_SERVER_KEY,
    clientKey:    process.env.MIDTRANS_CLIENT_KEY
});

// ── Email transporter (reuse existing config) ────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ── Helpers ──────────────────────────────────────────────────────
const ADMIN_WA = 'GANTI_NOMOR_WA_ADMIN';

async function kirimKeTelegram(pesan) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
            { chat_id: process.env.TELEGRAM_CHAT_ID, text: pesan, parse_mode: 'HTML' }
        );
    } catch (e) { console.error('Telegram error:', e.message); }
}

async function kirimKeWhatsApp(nomorHP, pesan) {
    try {
        let nomor = String(nomorHP).replace(/[^0-9]/g, '');
        if (nomor.startsWith('08')) nomor = '62' + nomor.slice(1);
        await axios.post('https://api.fonnte.com/send',
            { target: nomor, message: pesan, countryCode: '62' },
            { headers: { 'Authorization': process.env.FONNTE_TOKEN } }
        );
    } catch (e) { console.error('WA error:', e.message); }
}


// ── Parse detail_produk dari format lama ─────────────────────────
function parseDetailProduk(raw) {
    if (!raw) return [];
    return raw.split(/\s*\|\s*/).filter(Boolean).map(item => {
        const m = item.match(/^(.+?)\s*\((https?:\/\/[^)]+)\)\s*$/);
        return m ? { label: m[1].trim(), url: m[2].trim() } : { label: item.replace(/\s*\(https?:\/\/[^)]+\)/g,'').trim(), url: null };
    }).filter(i => i.label);
}

// ── CORS ─────────────────────────────────────────────────────────
router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── Rate limiter ─────────────────────────────────────────────────
const rlMap = new Map();
function rateLimit(req, res, next) {
    const ip  = (req.headers['x-forwarded-for'] || req.ip || 'x').split(',')[0].trim();
    const now = Date.now();
    const e   = rlMap.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > e.resetAt) { e.count = 0; e.resetAt = now + 60000; }
    e.count++; rlMap.set(ip, e);
    if (e.count > 10) return res.status(429).json({ status: 'rate_limited', message: 'Terlalu banyak percobaan.' });
    next();
}
setInterval(() => { const n=Date.now(); rlMap.forEach((v,k)=>{ if(n>v.resetAt) rlMap.delete(k); }); }, 300000);

// ── Admin auth ───────────────────────────────────────────────────
function adminAuth(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    const token  = req.headers['x-admin-secret'] || req.query.secret;
    if (!secret || !token || token !== secret) return res.status(401).json({ status: 'unauthorized' });
    next();
}

// ══════════════════════════════════════════════════════════════════
// MODE MAINTENANCE — bisa diaktifkan/matikan admin per fitur, tanpa
// perlu redeploy. Disimpan di tabel key-value app_settings (lihat
// SQL_MIGRATION_FITUR_BARU.sql). Dicek di 2 titik: fitur "Cari" (cek
// pesanan) dan fitur "Beli" (create-transaction), sesuai 2 tombol yang
// diminta admin untuk bisa dimatikan sementara selagi masih development.
// ══════════════════════════════════════════════════════════════════
async function getMaintenance() {
    try {
        const rows = await prisma.$queryRaw`SELECT value FROM app_settings WHERE key='maintenance'`;
        if (!rows.length) return { cari: false, beli: false };
        let v = rows[0].value;
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
        return { cari: !!v.cari, beli: !!v.beli };
    } catch (e) {
        console.warn('Gagal ambil status maintenance, anggap non-aktif:', e.message);
        return { cari: false, beli: false };
    }
}

router.get('/maintenance', async (req, res) => {
    const m = await getMaintenance();
    return res.json({ status: 'ok', ...m });
});

// ══════════════════════════════════════════════════════════════════
// POST /api/public/cari-link  (admin) — cari link dari master produk
// untuk string variasi. Dipakai orders.html untuk auto-isi link pesanan
// yang saat bayar belum ketemu (link master baru dilengkapi belakangan),
// tanpa harus input manual. Format detail_produk = "variasi1 | variasi2".
// ══════════════════════════════════════════════════════════════════
router.post('/cari-link', adminAuth, async (req, res) => {
    const { detail_produk } = req.body || {};
    if (!detail_produk) return res.status(400).json({ status: 'error', message: 'detail_produk wajib diisi.' });
    try {
        const produkList = await bedahDanCariLink(detail_produk);
        return res.json({ status: 'ok', produkList });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

router.put('/maintenance', adminAuth, async (req, res) => {
    const value = { cari: !!(req.body || {}).cari, beli: !!(req.body || {}).beli };
    try {
        await prisma.$queryRaw`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('maintenance', ${JSON.stringify(value)}::jsonb, now())
            ON CONFLICT (key) DO UPDATE SET value=${JSON.stringify(value)}::jsonb, updated_at=now()`;
        return res.json({ status: 'ok', ...value });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════
// PESANAN SHOPEE
// ══════════════════════════════════════════════════════════════════
router.get('/pesanan/:no_pesanan', rateLimit, async (req, res) => {
    const m = await getMaintenance();
    if (m.cari) return res.json({ status: 'maintenance', message: 'Fitur cek pesanan sedang maintenance. Coba lagi nanti.' });
    const raw = req.params.no_pesanan?.trim().toUpperCase();
    if (!raw || !/^[A-Z0-9]{8,25}$/.test(raw))
        return res.status(400).json({ status: 'invalid' });
    try {
        const order = await prisma.shopeeOrder.findUnique({
            where: { no_pesanan: raw },
            select: { no_pesanan: true, detail_produk: true, username_pembeli: true }
        });
        if (!order) return res.json({ status: 'not_found', message: 'Nomor pesanan belum diproses, tunggu sekitar satu menit lagi.' });
        const produk_list  = parseDetailProduk(order.detail_produk);
        const adaLink      = produk_list.some(p => p.url);
        const semuaAdaLink = produk_list.every(p => p.url) && produk_list.length > 0;
        if (!adaLink) return res.json({ status: 'no_link', no_pesanan: order.no_pesanan, nama_pembeli: order.username_pembeli, produk_list });
        return res.json({ status: 'found', no_pesanan: order.no_pesanan, nama_pembeli: order.username_pembeli, produk_list, ada_link_kosong: !semuaAdaLink });
    } catch (e) { return res.status(500).json({ status: 'error', message: 'Kesalahan server.' }); }
});

router.patch('/pesanan/:no_pesanan/ambil', async (req, res) => {
    const raw = req.params.no_pesanan?.trim().toUpperCase();
    if (!raw || !/^[A-Z0-9]{8,25}$/.test(raw)) return res.status(400).json({ status: 'invalid' });
    try {
        const order = await prisma.shopeeOrder.findUnique({ where: { no_pesanan: raw }, select: { status_aksi: true } });
        if (!order) return res.status(404).json({ status: 'not_found' });
        // Jika belum TERKIRIM, update statusnya
        if (order.status_aksi !== 'TERKIRIM') {
            await prisma.shopeeOrder.update({ where: { no_pesanan: raw }, data: { status_aksi: 'TERKIRIM' } });
        }

        // Selalu kirim notif Telegram setiap kali pembeli ambil link
        const sudahTerkirimSebelumnya = order.status_aksi === 'TERKIRIM';
        await kirimKeTelegram(
            `📥 <b>Link Diambil oleh Pembeli</b>\n\n` +
            `📦 No. Pesanan: <code>${raw}</code>\n` +
            `✅ Status: <b>TERKIRIM</b>\n` +
            (sudahTerkirimSebelumnya ? `🔁 <i>Pembeli mengambil link lagi (sudah pernah diambil sebelumnya)</i>` : `🆕 <i>Pertama kali diambil via halaman cek pesanan</i>`)
        ).catch(() => {});
        return res.json({ status: 'ok', updated: true });
    } catch (e) { return res.status(500).json({ status: 'error' }); }
});

// ══════════════════════════════════════════════════════════════════
// KATALOG PRODUK
// ══════════════════════════════════════════════════════════════════
router.get('/katalog', async (req, res) => {
    try {
        let rows;
        try {
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, harga, urutan
                FROM catalog_products WHERE aktif = true
                ORDER BY urutan ASC, id ASC`;
        } catch {
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, urutan,
                       NULL as harga
                FROM catalog_products WHERE aktif = true
                ORDER BY urutan ASC, id ASC`;
        }
        return res.json({ status: 'ok', data: rows });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.get('/katalog/all', adminAuth, async (req, res) => {
    try {
        let rows;
        try {
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, harga, deskripsi,
                       variasi_config, link_contoh, urutan, aktif, stok_habis
                FROM catalog_products ORDER BY urutan ASC, id ASC`;
        } catch {
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, urutan, aktif,
                       NULL as harga, NULL as deskripsi,
                       '[]'::text as variasi_config, NULL as link_contoh,
                       '[]'::text as stok_habis
                FROM catalog_products ORDER BY urutan ASC, id ASC`;
        }
        // Pastikan variasi_config & stok_habis selalu array yang valid
        rows = rows.map(r => {
            let vc = r.variasi_config;
            if (typeof vc === 'string') { try { vc = JSON.parse(vc); } catch { vc = []; } }
            if (!Array.isArray(vc)) vc = [];
            let sh = r.stok_habis;
            if (typeof sh === 'string') { try { sh = JSON.parse(sh); } catch { sh = []; } }
            if (!Array.isArray(sh)) sh = [];
            return { ...r, variasi_config: vc, stok_habis: sh };
        });
        return res.json({ status: 'ok', data: rows });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.get('/katalog/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: 'error', message: 'ID tidak valid.' });
    try {
        // Coba query dengan semua kolom baru dulu
        let rows;
        try {
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, harga, deskripsi,
                       variasi_config, link_contoh, urutan, stok_habis
                FROM catalog_products WHERE id = ${id} AND aktif = true`;
        } catch (colErr) {
            // Fallback: query hanya kolom lama jika kolom baru belum ada
            console.warn('Kolom baru belum ada, fallback ke kolom lama:', colErr.message);
            rows = await prisma.$queryRaw`
                SELECT id, nama, foto_url, link_co, urutan,
                       NULL as harga, NULL as deskripsi,
                       '[]'::text as variasi_config, NULL as link_contoh,
                       '[]'::text as stok_habis
                FROM catalog_products WHERE id = ${id} AND aktif = true`;
        }

        if (!rows || !rows.length) {
            return res.status(404).json({ status: 'not_found', message: 'Produk tidak ditemukan.' });
        }

        // Pastikan variasi_config & stok_habis adalah array
        const produk = rows[0];
        if (typeof produk.variasi_config === 'string') {
            try { produk.variasi_config = JSON.parse(produk.variasi_config); }
            catch { produk.variasi_config = []; }
        }
        if (!Array.isArray(produk.variasi_config)) produk.variasi_config = [];

        if (typeof produk.stok_habis === 'string') {
            try { produk.stok_habis = JSON.parse(produk.stok_habis); }
            catch { produk.stok_habis = []; }
        }
        if (!Array.isArray(produk.stok_habis)) produk.stok_habis = [];

        return res.json({ status: 'ok', data: produk });
    } catch (e) {
        console.error('Katalog detail error:', e.message);
        return res.status(500).json({ status: 'error', message: 'Kesalahan server: ' + e.message });
    }
});

// ── Share produk (OG meta tag untuk preview WA/FB/Telegram) ─────────
// Crawler platform share (WhatsApp dll) mengambil meta og:image dari HTML
// mentah URL yang dibagikan, TANPA menjalankan JavaScript. produk.html di
// storefront adalah shell kosong yang baru diisi data produk lewat JS
// setelah fetch API, jadi crawler cuma lihat meta generik (fallback ke
// logo). Endpoint ini render HTML dengan og:image = foto produk, lalu
// redirect pengguna asli ke halaman produk sesungguhnya.
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

router.get('/share/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const frontendUrl = process.env.FRONTEND_URL || 'https://hanunstore.com';
    const targetUrl = `${frontendUrl}/produk.html?id=${id}`;

    if (isNaN(id)) return res.redirect(302, `${frontendUrl}/produk.html`);

    try {
        const rows = await prisma.$queryRaw`
            SELECT nama, foto_url, deskripsi, harga
            FROM catalog_products WHERE id = ${id} AND aktif = true`;

        if (!rows || !rows.length) return res.redirect(302, `${frontendUrl}/produk.html`);

        const p = rows[0];
        const judul = p.nama || 'Produk Hanun Store';
        const deskripsi = (p.deskripsi || 'Perangkat ajar digital siap pakai — Hanun Store').slice(0, 160);

        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>${escHtml(judul)} — Hanun Store</title>
<meta property="og:type" content="product">
<meta property="og:title" content="${escHtml(judul)}">
<meta property="og:description" content="${escHtml(deskripsi)}">
<meta property="og:image" content="${escHtml(p.foto_url || '')}">
<meta property="og:url" content="${escHtml(targetUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escHtml(targetUrl)}">
<script>location.replace(${JSON.stringify(targetUrl)});</script>
</head>
<body>
<p>Mengalihkan ke <a href="${escHtml(targetUrl)}">${escHtml(judul)}</a>...</p>
</body>
</html>`);
    } catch (e) {
        console.error('Share produk error:', e.message);
        return res.redirect(302, `${frontendUrl}/produk.html`);
    }
});

router.post('/katalog', adminAuth, async (req, res) => {
    const { nama, foto_url, link_co, harga, deskripsi, variasi_config, link_contoh, urutan, stok_habis } = req.body || {};
    if (!nama || !foto_url) return res.status(400).json({ status: 'error', message: 'nama dan foto_url wajib.' });
    try {
        const ord  = parseInt(urutan) || 0;
        const hrg  = parseInt(harga)  || 0;
        const varJ = JSON.stringify(variasi_config || []);
        const stkJ = JSON.stringify(stok_habis || []);
        const row  = await prisma.$queryRaw`
            INSERT INTO catalog_products (nama, foto_url, link_co, harga, deskripsi, variasi_config, link_contoh, urutan, aktif, stok_habis)
            VALUES (${nama}, ${foto_url}, ${link_co||''}, ${hrg}, ${deskripsi||''}, ${varJ}::jsonb, ${link_contoh||''}, ${ord}, true, ${stkJ}::jsonb)
            RETURNING id, nama, foto_url, link_co, harga, deskripsi, variasi_config, link_contoh, urutan, aktif, stok_habis`;
        return res.json({ status: 'ok', data: row[0] });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.put('/katalog/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { nama, foto_url, link_co, harga, deskripsi, variasi_config, link_contoh, urutan, aktif, stok_habis } = req.body || {};
    if (!nama || !foto_url) return res.status(400).json({ status: 'error', message: 'nama dan foto_url wajib.' });
    try {
        const ord  = parseInt(urutan) || 0;
        const hrg  = parseInt(harga)  || 0;
        const aktf = aktif !== undefined ? aktif : true;
        const varJ = JSON.stringify(variasi_config || []);
        const stkJ = JSON.stringify(stok_habis || []);
        const row  = await prisma.$queryRaw`
            UPDATE catalog_products
            SET nama=${nama}, foto_url=${foto_url}, link_co=${link_co||''}, harga=${hrg},
                deskripsi=${deskripsi||''}, variasi_config=${varJ}::jsonb,
                link_contoh=${link_contoh||''}, urutan=${ord}, aktif=${aktf}, stok_habis=${stkJ}::jsonb
            WHERE id=${id}
            RETURNING id, nama, foto_url, link_co, harga, deskripsi, variasi_config, link_contoh, urutan, aktif, stok_habis`;
        if (!row.length) return res.status(404).json({ status: 'error' });
        return res.json({ status: 'ok', data: row[0] });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.delete('/katalog/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await prisma.$queryRaw`DELETE FROM catalog_products WHERE id=${id}`;
        return res.json({ status: 'ok' });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// MIDTRANS — Buat Transaksi
// POST /api/public/midtrans/create-transaction
// ══════════════════════════════════════════════════════════════════
router.post('/midtrans/create-transaction', async (req, res) => {
    const mMaint = await getMaintenance();
    if (mMaint.beli) return res.status(503).json({ status: 'maintenance', message: 'Fitur pembelian sedang maintenance. Coba lagi nanti.' });

    const { customer_name, customer_email, customer_wa, items, kode_referral } = req.body || {};

    if (!customer_name || !customer_email || !customer_wa || !items?.length)
        return res.status(400).json({ status: 'error', message: 'Data tidak lengkap.' });

    // Validasi email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email))
        return res.status(400).json({ status: 'error', message: 'Format email tidak valid.' });

    // Hitung subtotal
    let subtotal = items.reduce((sum, i) => sum + (parseInt(i.harga) * (parseInt(i.qty) || 1)), 0);
    let total = subtotal;
    let referralInfo = null;

    // ── Validasi & terapkan kode referral jika ada ──────────────────
    if (kode_referral && kode_referral.trim()) {
        const kodeUpper = kode_referral.trim().toUpperCase();
        try {
            const refRows = await prisma.$queryRaw`
                SELECT * FROM referral_codes WHERE kode=${kodeUpper} AND aktif=true`;
            if (refRows.length) {
                const ref = refRows[0];
                if (ref.jumlah_terpakai < ref.maks_pemakaian) {
                    let diskon = 0;
                    if (ref.tipe_diskon === 'persen') {
                        diskon = Math.round(subtotal * (ref.nilai_diskon / 100));
                    } else {
                        diskon = ref.nilai_diskon;
                    }
                    diskon = Math.min(diskon, subtotal - 1000); // minimal total tetap Rp1.000
                    if (diskon > 0) {
                        total = subtotal - diskon;
                        referralInfo = { kode: kodeUpper, diskon, tipe: ref.tipe_diskon, nilai: ref.nilai_diskon };
                    }
                }
            }
        } catch (e) { console.warn('Referral check error:', e.message); }
    }

    if (total < 1000) return res.status(400).json({ status: 'error', message: 'Total minimal Rp 1.000.' });

    // ── Cek stok habis untuk setiap item ────────────────────────────
    for (const item of items) {
        if (!item.produk_id) continue;
        try {
            const prodRows = await prisma.$queryRaw`
                SELECT stok_habis FROM catalog_products WHERE id=${parseInt(item.produk_id)}`;
            if (prodRows.length) {
                let stokHabis = prodRows[0].stok_habis;
                if (typeof stokHabis === 'string') { try { stokHabis = JSON.parse(stokHabis); } catch { stokHabis = []; } }
                if (!Array.isArray(stokHabis)) stokHabis = [];
                const variasiKey = (item.variasi || '').split(' — ').join('-').split(' - ').join('-');
                if (stokHabis.includes(variasiKey) || stokHabis.includes(item.variasi)) {
                    return res.status(400).json({ status: 'error', message: `Maaf, "${item.nama}${item.variasi ? ' - '+item.variasi : ''}" sedang stok habis.` });
                }
            }
        } catch (e) { console.warn('Stok check error:', e.message); }
    }

    // Buat order ID unik
    const orderId = `PD-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;

    try {
        // Simpan ke DB dulu (status pending)
        await prisma.$queryRaw`
            INSERT INTO midtrans_orders (id, customer_name, customer_email, customer_wa, items, total, status, referral_data)
            VALUES (${orderId}, ${customer_name}, ${customer_email}, ${customer_wa},
                    ${JSON.stringify(items)}::jsonb, ${total}, 'pending',
                    ${referralInfo ? JSON.stringify(referralInfo) : null}::jsonb)`;

        // Buat Midtrans Snap token
        const itemDetails = items.map(i => ({
            id:       String(i.produk_id),
            name:     `${i.nama}${i.variasi ? ' - ' + i.variasi : ''}`.substring(0, 50),
            price:    parseInt(i.harga),
            quantity: parseInt(i.qty) || 1
        }));

        // Tambahkan baris diskon jika ada referral
        if (referralInfo && referralInfo.diskon > 0) {
            itemDetails.push({
                id: 'DISKON', name: `Diskon (${referralInfo.kode})`, price: -referralInfo.diskon, quantity: 1
            });
        }

        const parameter = {
            transaction_details: { order_id: orderId, gross_amount: total },
            customer_details: {
                first_name:   customer_name,
                email:        customer_email,
                phone:        customer_wa
            },
            item_details: itemDetails,
            callbacks: {
                finish: `${process.env.FRONTEND_URL || 'https://hanunstore.com'}/success.html`
            }
        };

        const snapToken = await snap.createTransactionToken(parameter);

        // Simpan snap token
        await prisma.$queryRaw`
            UPDATE midtrans_orders SET snap_token=${snapToken} WHERE id=${orderId}`;

        // Increment pemakaian referral (optimistic, sebelum bayar — supaya tidak race condition saat banyak orang pakai kode bersamaan)
        if (referralInfo) {
            await prisma.$queryRaw`
                UPDATE referral_codes SET jumlah_terpakai = jumlah_terpakai + 1 WHERE kode=${referralInfo.kode}`.catch(()=>{});
        }

        return res.json({
            status:     'ok',
            order_id:   orderId,
            snap_token: snapToken,
            client_key: process.env.MIDTRANS_CLIENT_KEY,
            subtotal,
            diskon:     referralInfo ? referralInfo.diskon : 0,
            total
        });

    } catch (e) {
        console.error('Create transaction error:', e.message);
        return res.status(500).json({ status: 'error', message: 'Gagal membuat transaksi.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/public/referral/validasi — cek kode referral saat checkout
// ══════════════════════════════════════════════════════════════════
router.post('/referral/validasi', async (req, res) => {
    const { kode, subtotal } = req.body || {};
    if (!kode) return res.status(400).json({ status: 'error', message: 'Kode wajib diisi.' });

    try {
        const kodeUpper = kode.trim().toUpperCase();
        const rows = await prisma.$queryRaw`
            SELECT * FROM referral_codes WHERE kode=${kodeUpper} AND aktif=true`;
        if (!rows.length) return res.json({ status: 'invalid', message: 'Kode referral tidak ditemukan atau sudah tidak aktif.' });

        const ref = rows[0];
        if (ref.jumlah_terpakai >= ref.maks_pemakaian) {
            return res.json({ status: 'invalid', message: 'Kode referral sudah mencapai batas pemakaian.' });
        }

        let diskon = 0;
        if (ref.tipe_diskon === 'persen') diskon = Math.round((parseInt(subtotal)||0) * (ref.nilai_diskon/100));
        else diskon = ref.nilai_diskon;

        return res.json({
            status: 'ok',
            kode: kodeUpper,
            tipe_diskon: ref.tipe_diskon,
            nilai_diskon: ref.nilai_diskon,
            diskon,
            sisa_pemakaian: ref.maks_pemakaian - ref.jumlah_terpakai
        });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// ADMIN — Kelola Kode Referral
// ══════════════════════════════════════════════════════════════════
router.get('/referral', adminAuth, async (req, res) => {
    try {
        const rows = await prisma.$queryRaw`SELECT * FROM referral_codes ORDER BY created_at DESC`;
        return res.json({ status: 'ok', data: rows });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.post('/referral', adminAuth, async (req, res) => {
    const { kode, tipe_diskon, nilai_diskon, maks_pemakaian } = req.body || {};
    if (!kode || !tipe_diskon || !nilai_diskon || !maks_pemakaian)
        return res.status(400).json({ status: 'error', message: 'Semua field wajib diisi.' });
    if (!['persen','nominal'].includes(tipe_diskon))
        return res.status(400).json({ status: 'error', message: 'Tipe diskon tidak valid.' });

    try {
        const kodeUpper = kode.trim().toUpperCase().replace(/\s+/g,'');
        const row = await prisma.$queryRaw`
            INSERT INTO referral_codes (kode, tipe_diskon, nilai_diskon, maks_pemakaian, aktif)
            VALUES (${kodeUpper}, ${tipe_diskon}, ${parseInt(nilai_diskon)}, ${parseInt(maks_pemakaian)}, true)
            RETURNING *`;
        return res.json({ status: 'ok', data: row[0] });
    } catch (e) {
        if (e.message.includes('unique') || e.message.includes('duplicate')) {
            return res.status(400).json({ status: 'error', message: 'Kode referral sudah dipakai, gunakan kode lain.' });
        }
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

router.put('/referral/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const { tipe_diskon, nilai_diskon, maks_pemakaian, aktif } = req.body || {};
    try {
        const row = await prisma.$queryRaw`
            UPDATE referral_codes
            SET tipe_diskon=${tipe_diskon}, nilai_diskon=${parseInt(nilai_diskon)},
                maks_pemakaian=${parseInt(maks_pemakaian)}, aktif=${aktif}
            WHERE id=${id} RETURNING *`;
        if (!row.length) return res.status(404).json({ status: 'error' });
        return res.json({ status: 'ok', data: row[0] });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

router.delete('/referral/:id', adminAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await prisma.$queryRaw`DELETE FROM referral_codes WHERE id=${id}`;
        return res.json({ status: 'ok' });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/public/midtrans/order/:order_id/cancel
// Pembeli batalkan pembayaran tertunda
// ══════════════════════════════════════════════════════════════════
router.post('/midtrans/order/:order_id/cancel', async (req, res) => {
    const orderId = req.params.order_id;
    if (!orderId || !/^PD-\d+-[A-Z0-9]+$/.test(orderId))
        return res.status(400).json({ status: 'error', message: 'Order ID tidak valid.' });
    try {
        const rows = await prisma.$queryRaw`SELECT status FROM midtrans_orders WHERE id=${orderId}`;
        if (!rows.length) return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });

        if (['paid','settlement','capture'].includes(rows[0].status)) {
            return res.status(400).json({ status: 'error', message: 'Pesanan sudah dibayar, tidak bisa dibatalkan.' });
        }

        // Coba cancel di Midtrans juga (boleh gagal kalau transaksi belum punya status di Midtrans)
        try { await snap.transaction.cancel(orderId); } catch (e) { console.warn('Midtrans cancel warning:', e.message); }

        await prisma.$queryRaw`
            UPDATE midtrans_orders SET status='cancel', updated_at=now() WHERE id=${orderId}`;

        return res.json({ status: 'ok', message: 'Pesanan berhasil dibatalkan.' });
    } catch (e) {
        console.error('Cancel order error:', e.message);
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════
// PATCH /api/public/midtrans/order/:order_id/status  (admin dashboard)
// Ubah status pesanan Web secara manual dari dashboard admin.
// ══════════════════════════════════════════════════════════════════
router.patch('/midtrans/order/:order_id/status', adminAuth, async (req, res) => {
    const orderId = req.params.order_id;
    const { status } = req.body || {};
    const allowed = ['paid', 'pending', 'cancel', 'expire'];
    if (!orderId || !/^PD-\d+-[A-Z0-9]+$/.test(orderId))
        return res.status(400).json({ status: 'error', message: 'Order ID tidak valid.' });
    if (!allowed.includes(status))
        return res.status(400).json({ status: 'error', message: 'Status tidak valid.' });
    try {
        const rows = await prisma.$queryRaw`
            UPDATE midtrans_orders SET status=${status}, updated_at=now()
            WHERE id=${orderId} RETURNING id`;
        if (!rows.length) return res.status(404).json({ status: 'error', message: 'Pesanan tidak ditemukan.' });
        return res.json({ status: 'ok' });
    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
});



// ══════════════════════════════════════════════════════════════════
// MIDTRANS — Webhook Notifikasi Pembayaran
// POST /api/public/midtrans/notification
// (Daftarkan URL ini di dashboard Midtrans → Settings → Configuration)
// ══════════════════════════════════════════════════════════════════
router.post('/midtrans/notification', async (req, res) => {
    // PENTING (Vercel serverless): JANGAN balas 200 sebelum semua proses
    // selesai. Begitu response terkirim, function bisa dibekukan kapan saja,
    // sehingga update status / kirim email-WA-Telegram mati di tengah jalan
    // (gejala nyata: order nyangkut 'pending' padahal sudah dibayar, atau
    // email terkirim tapi WA & Telegram tidak). Midtrans menunggu response
    // dan otomatis retry kalau dapat non-2xx/timeout — jadi proses dulu,
    // baru balas. Kiriman ganda saat retry dicegah guard idempoten di bawah.
    try {
        const notification = await snap.transaction.notification(req.body);
        const orderId      = notification.order_id;
        const txStatus     = notification.transaction_status;
        const fraudStatus  = notification.fraud_status;

        console.log(`[Midtrans] Order: ${orderId} | Status: ${txStatus} | Fraud: ${fraudStatus}`);

        // Tentukan status final
        let statusFinal = 'pending';
        if (txStatus === 'capture') {
            statusFinal = fraudStatus === 'accept' ? 'paid' : 'fraud';
        } else if (txStatus === 'settlement') {
            statusFinal = 'paid';
        } else if (['cancel','deny','expire'].includes(txStatus)) {
            statusFinal = txStatus;
        } else if (txStatus === 'pending') {
            statusFinal = 'pending';
        }

        // Ambil kondisi order SEBELUM update — dipakai guard idempoten
        // (Midtrans bisa mengirim notifikasi yang sama lebih dari sekali).
        const orders = await prisma.$queryRaw`
            SELECT * FROM midtrans_orders WHERE id=${orderId}`;
        if (!orders.length) return res.status(200).json({ status: 'ok' });
        const order = orders[0];

        const statusSebelum = order.status;
        let linkSebelum = order.link_produk;
        if (typeof linkSebelum === 'string') {
            try { linkSebelum = JSON.parse(linkSebelum); } catch { linkSebelum = null; }
        }

        // Update status di DB
        await prisma.$queryRaw`
            UPDATE midtrans_orders
            SET status=${statusFinal}, midtrans_data=${JSON.stringify(notification)}::jsonb,
                updated_at=now()
            WHERE id=${orderId}`;

        // Proses link + notifikasi hanya saat transisi ke PAID pertama kali.
        // Kalau sudah paid DAN link sudah pernah disimpan, ini notifikasi
        // duplikat/retry — jangan spam email/WA/Telegram lagi.
        const sudahDiproses = statusSebelum === 'paid'
            && Array.isArray(linkSebelum) && linkSebelum.length > 0;
        if (statusFinal !== 'paid' || sudahDiproses) {
            return res.status(200).json({ status: 'ok' });
        }

        const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

        // Cari link untuk setiap produk menggunakan bedahDanCariLink
        const linkHasil  = [];
        let   adaKosong  = false;

        for (const item of items) {
            // Pakai variasi SAJA, bukan nama (judul marketing produk) --
            // nama sering mengandung karakter "|" (mis. "PAG SMP/MTs ... |
            // PERANGKAT AJAR, MODUL AJAR, RPM") yang kalau ikut digabung
            // akan memecah parsing bedahDanCariLink (dia split input per "|").
            // variasi sudah berformat "KATEGORI MAPEL,KELAS" (mis. "PAG B
            // Indonesia,7") yang memang format yang dibaca fungsi itu.
            const detailStr = item.variasi || item.nama;

            const hasil = await bedahDanCariLink(detailStr);
            if (hasil.length && hasil[0].url) {
                linkHasil.push({ label: hasil[0].label, url: hasil[0].url });
            } else {
                linkHasil.push({ label: `${item.nama}${item.variasi ? ' - '+item.variasi : ''}`, url: null });
                adaKosong = true;
            }
        }

        // Simpan link ke DB
        await prisma.$queryRaw`
            UPDATE midtrans_orders SET link_produk=${JSON.stringify(linkHasil)}::jsonb WHERE id=${orderId}`;

        // ── Kirim Email ke Pembeli ────────────────────────────────
        let daftarLinkHtml = '';
        let daftarLinkWA   = '';

        linkHasil.forEach((item, i) => {
            const no = i + 1;
            if (item.url) {
                daftarLinkHtml += `<p style="margin:8px 0;"><strong>📌 ${no}. ${item.label}:</strong><br/>
                    <a href="${item.url}" style="color:#1B3A6B;word-break:break-all;">${item.url}</a></p>`;
                daftarLinkWA   += `*${no}. ${item.label}*\n${item.url}\n\n`;
            } else {
                daftarLinkHtml += `<p style="margin:8px 0;color:#dc2626;">⚠️ ${no}. ${item.label}: <em>Link akan dikirim manual oleh admin</em></p>`;
                daftarLinkWA   += `*${no}. ${item.label}*\n(Link menyusul dari admin)\n\n`;
            }
        });

        const pesanLinkKosong = adaKosong
            ? `<p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:12px 0;color:#dc2626;">
               ⚠️ Beberapa link belum tersedia otomatis. Admin akan mengirimkan link tersebut segera.
               Jika belum menerima dalam 1 jam, hubungi WA Admin: <strong>GANTI-NOMOR-WA-ADMIN</strong></p>`
            : '';

        const emailPromise = transporter.sendMail({
            from:    `"Hanun Store" <${process.env.EMAIL_USER}>`,
            to:      order.customer_email,
            subject: `✅ Pembayaran Berhasil — Pesanan ${orderId} | Hanun Store`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#334155;max-width:600px;">
                <div style="background:#1B3A6B;padding:20px;border-radius:10px 10px 0 0;text-align:center;">
                    <h2 style="color:#fff;margin:0;">🎉 Pembayaran Berhasil!</h2>
                    <p style="color:#F5A040;margin:4px 0;">Hanun Store — Perangkat Ajar Digital</p>
                </div>
                <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;">
                    <p>Assalamu'alaikum, <strong>${order.customer_name}</strong>! 👩‍🏫</p>
                    <p>Terima kasih telah berbelanja di <strong>Hanun Store</strong>.</p>
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
                        <p style="margin:0 0 8px;font-weight:700;color:#1B3A6B;">📦 No. Pesanan: ${orderId}</p>
                        <p style="margin:0;color:#64748b;">Total: Rp ${order.total.toLocaleString('id-ID')}</p>
                    </div>
                    <p style="font-weight:700;color:#1B3A6B;">📁 Link File Perangkat Ajar:</p>
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
                        ${daftarLinkHtml}
                    </div>
                    ${pesanLinkKosong}
                    <p style="margin-top:20px;"><strong>📋 Catatan Penting:</strong><br>
                    • Simpan email ini sebagai bukti pembelian<br>
                    • Link dapat diakses kapan saja<br>
                    • Kendala? WA Admin: <strong>GANTI-NOMOR-WA-ADMIN</strong></p>
                    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
                    <p style="color:#64748b;font-size:12px;text-align:center;">— Salam Hangat, Hanun Store —</p>
                </div>
            </div>`
        }).catch(e => console.error('Email error:', e.message));

        // ── Kirim WA ke Pembeli via Fonnte ────────────────────────
        const pesanWA =
            `Halo Kak *${order.customer_name}*! 👩‍🏫\n\n` +
            `Terima kasih sudah berbelanja di *Hanun Store*! 🙏\n\n` +
            `✅ *Pembayaran berhasil!*\nNo. Pesanan: *${orderId}*\n\n` +
            `📁 *Link Perangkat Ajar:*\n\n${daftarLinkWA}` +
            (adaKosong
                ? `⚠️ Beberapa link belum tersedia otomatis dan akan dikirim admin segera.\nKendala? Balas WA ini!\n\n`
                : '') +
            `Selamat mengajar! ✨`;

        // ── Notif Telegram ke Admin ───────────────────────────────
        const linkInfo = linkHasil.map((l,i) =>
            `${i+1}. ${l.label}: ${l.url ? '✅' : '❌ (kirim manual)'}`
        ).join('\n');

        const pesanTelegram =
            `🛒 <b>PEMBAYARAN BARU — Website!</b>\n\n` +
            `📦 Order: <code>${orderId}</code>\n` +
            `👤 Pembeli: ${order.customer_name}\n` +
            `📧 Email: ${order.customer_email}\n` +
            `📱 WA: ${order.customer_wa}\n` +
            `💰 Total: Rp ${order.total.toLocaleString('id-ID')}\n\n` +
            `<b>Status Link:</b>\n${linkInfo}\n\n` +
            (adaKosong ? `⚠️ <b>Ada link yang perlu dikirim manual!</b>` : `✅ Semua link berhasil terkirim otomatis`);

        // Kirim email + WA + Telegram PARALEL (bukan berurutan) supaya durasi
        // total tetap jauh di bawah batas eksekusi serverless; email SMTP
        // adalah yang paling lambat. Masing-masing kanal sudah menelan
        // error-nya sendiri, jadi satu kanal gagal tidak mematikan yang lain.
        // Semua DITUNGGU selesai sebelum balas — kerja yang masih jalan
        // setelah response bisa dibekukan platform kapan saja.
        await Promise.all([
            emailPromise,
            kirimKeWhatsApp(order.customer_wa, pesanWA),
            kirimKeTelegram(pesanTelegram)
        ]);

        return res.status(200).json({ status: 'ok' });
    } catch (e) {
        console.error('Midtrans notification error:', e.message);
        // Non-2xx → Midtrans retry otomatis; guard idempoten di atas
        // memastikan retry tidak mengirim email/WA ganda ke pembeli.
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════
// MIDTRANS — Cek Status Order
// GET /api/public/midtrans/order/:order_id
// ══════════════════════════════════════════════════════════════════
router.get('/midtrans/order/:order_id', async (req, res) => {
    const orderId = req.params.order_id;
    if (!orderId || !/^PD-\d+-[A-Z0-9]+$/.test(orderId))
        return res.status(400).json({ status: 'error', message: 'Order ID tidak valid.' });
    try {
        const rows = await prisma.$queryRaw`
            SELECT id, customer_name, customer_email, customer_wa, items, total,
                   status, link_produk, snap_token, created_at
            FROM midtrans_orders WHERE id=${orderId}`;
        if (!rows.length) return res.status(404).json({ status: 'not_found' });
        const order = rows[0];

        const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        let linkProduk = typeof order.link_produk === 'string' ? JSON.parse(order.link_produk) : (order.link_produk || []);

        // Auto-resolve link dari master untuk pesanan LUNAS yang link_produk-nya
        // kosong/sebagian. Menutup race (success.html render sebelum webhook
        // selesai menyimpan link) & kegagalan webhook. Resolve PER ITEM supaya
        // sejajar indeks dengan items (aman untuk variasi multi-kelas per item).
        const isPaid = ['paid','settlement','capture'].includes(order.status);
        const perluResolve = isPaid && items.length &&
            (linkProduk.length < items.length || linkProduk.some(l => !l || !l.url));
        if (perluResolve) {
            try {
                const rebuilt = [];
                let adaBaru = false;
                for (let i = 0; i < items.length; i++) {
                    const prev = linkProduk[i];
                    if (prev && prev.url) { rebuilt.push(prev); continue; }
                    const it = items[i];
                    const hasil = await bedahDanCariLink(it.variasi || it.nama);
                    const found = (hasil || []).find(h => h.url) || (hasil || [])[0];
                    const url   = (found && found.url) || null;
                    if (url) adaBaru = true;
                    rebuilt.push({
                        label: (found && found.label) || (prev && prev.label) || (it.variasi || it.nama),
                        url
                    });
                }
                // Persist hanya kalau ada url baru yang terisi (hindari tulis sia-sia)
                if (adaBaru) {
                    await prisma.$queryRaw`
                        UPDATE midtrans_orders SET link_produk=${JSON.stringify(rebuilt)}::jsonb, updated_at=now()
                        WHERE id=${orderId}`.catch(() => {});
                }
                linkProduk = rebuilt;
            } catch (e) { console.warn('Auto-resolve link error:', e.message); }
        }

        return res.json({
            status:        'ok',
            order_id:      order.id,
            customer_name: order.customer_name,
            customer_wa:   order.customer_wa,
            items,
            total:         order.total,
            payment_status: order.status,
            link_produk:   linkProduk,
            snap_token:    order.snap_token,
            created_at:    order.created_at
        });
    } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/public/midtrans/order/:order_id/regenerate-token
// Buat ulang Snap token jika yang lama sudah expired (>24 jam)
// Dipakai di halaman "Pembayaran Tertunda" agar pembeli bisa lanjut bayar
// ══════════════════════════════════════════════════════════════════
router.post('/midtrans/order/:order_id/regenerate-token', async (req, res) => {
    const orderId = req.params.order_id;
    if (!orderId || !/^PD-\d+-[A-Z0-9]+$/.test(orderId))
        return res.status(400).json({ status: 'error', message: 'Order ID tidak valid.' });
    try {
        const rows = await prisma.$queryRaw`
            SELECT * FROM midtrans_orders WHERE id=${orderId}`;
        if (!rows.length) return res.status(404).json({ status: 'not_found', message: 'Pesanan tidak ditemukan.' });
        const order = rows[0];

        if (['paid','settlement','capture'].includes(order.status)) {
            return res.status(400).json({ status: 'error', message: 'Pesanan ini sudah dibayar.' });
        }
        if (['cancel','expire','deny'].includes(order.status)) {
            return res.status(400).json({ status: 'error', message: 'Pesanan ini sudah dibatalkan/kedaluwarsa. Silakan buat pesanan baru.' });
        }

        const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

        const parameter = {
            transaction_details: { order_id: orderId, gross_amount: order.total },
            customer_details: {
                first_name: order.customer_name,
                email:      order.customer_email,
                phone:      order.customer_wa
            },
            item_details: items.map(i => ({
                id:       String(i.produk_id),
                name:     `${i.nama}${i.variasi ? ' - ' + i.variasi : ''}`.substring(0, 50),
                price:    parseInt(i.harga),
                quantity: parseInt(i.qty) || 1
            })),
            callbacks: {
                finish: `${process.env.FRONTEND_URL || 'https://hanunstore.com'}/success.html`
            }
        };

        const snapToken = await snap.createTransactionToken(parameter);

        await prisma.$queryRaw`
            UPDATE midtrans_orders SET snap_token=${snapToken}, updated_at=now() WHERE id=${orderId}`;

        return res.json({
            status:     'ok',
            order_id:   orderId,
            snap_token: snapToken,
            client_key: process.env.MIDTRANS_CLIENT_KEY
        });
    } catch (e) {
        console.error('Regenerate token error:', e.message);
        return res.status(500).json({ status: 'error', message: 'Gagal membuat ulang link pembayaran.' });
    }
});

// ── Midtrans client key publik ────────────────────────────────────
router.get('/midtrans/config', (req, res) => {
    res.json({
        client_key:    process.env.MIDTRANS_CLIENT_KEY,
        is_production: process.env.MIDTRANS_IS_PRODUCTION === 'true'
    });
});

// ══════════════════════════════════════════════════════════════════
// GET /api/public/midtrans/orders — semua pesanan untuk admin
// ══════════════════════════════════════════════════════════════════
router.get('/midtrans/orders', adminAuth, async (req, res) => {
    const { status, from, to, search, limit = 50, offset = 0 } = req.query;
    try {
        let rows = await prisma.$queryRaw`
            SELECT id, customer_name, customer_email, customer_wa,
                   items, total, status, link_produk, created_at, updated_at
            FROM midtrans_orders
            ORDER BY created_at DESC
            LIMIT 200`;

        // Filter di JS (lebih fleksibel untuk serverless)
        if (status && status !== 'all') rows = rows.filter(r => r.status === status);
        if (from)   rows = rows.filter(r => new Date(r.created_at) >= new Date(from));
        if (to)     rows = rows.filter(r => new Date(r.created_at) <= new Date(to + 'T23:59:59'));
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter(r =>
                r.id.toLowerCase().includes(q) ||
                r.customer_name.toLowerCase().includes(q) ||
                r.customer_email.toLowerCase().includes(q)
            );
        }

        const total_count = rows.length;
        rows = rows.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        // Parse JSON fields + tambah field "produk" (ringkasan siap tampil,
        // dibangun dari variasi SAJA -- persis format yang dikirim ke
        // bedahDanCariLink, "variasi1|variasi2" -- bukan nama marketing
        // yang panjang. Konsisten dengan field o.produk di sisi Shopee.
        rows = rows.map(r => {
            const items       = typeof r.items === 'string'       ? JSON.parse(r.items)       : (r.items || []);
            const link_produk = typeof r.link_produk === 'string' ? JSON.parse(r.link_produk) : (r.link_produk || []);
            return {
                ...r,
                items,
                link_produk,
                produk: items.map(i => i.variasi || i.nama).join(' | ')
            };
        });

        return res.json({ status: 'ok', data: rows, total_count });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════
// GET /api/public/midtrans/rekap — rekap keuangan untuk admin
// ══════════════════════════════════════════════════════════════════
router.get('/midtrans/rekap', adminAuth, async (req, res) => {
    try {
        const rows = await prisma.$queryRaw`
            SELECT id, total, status, items, created_at
            FROM midtrans_orders
            WHERE status IN ('paid', 'settlement', 'capture')
            ORDER BY created_at DESC`;

        const now   = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const week  = new Date(today); week.setDate(today.getDate() - 6);
        const month = new Date(now.getFullYear(), now.getMonth(), 1);
        const year  = new Date(now.getFullYear(), 0, 1);

        const omzetHari  = rows.filter(r => new Date(r.created_at) >= today).reduce((s,r) => s + (r.total||0), 0);
        const omzetMinggu= rows.filter(r => new Date(r.created_at) >= week).reduce((s,r) => s + (r.total||0), 0);
        const omzetBulan = rows.filter(r => new Date(r.created_at) >= month).reduce((s,r) => s + (r.total||0), 0);
        const omzetTahun = rows.filter(r => new Date(r.created_at) >= year).reduce((s,r) => s + (r.total||0), 0);
        const omzetTotal = rows.reduce((s,r) => s + (r.total||0), 0);

        // Transaksi per hari (30 hari terakhir)
        const tiga0Hari = new Date(today); tiga0Hari.setDate(today.getDate() - 29);
        const perHari   = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(tiga0Hari); d.setDate(tiga0Hari.getDate() + i);
            const key = d.toISOString().slice(0,10);
            perHari[key] = { tanggal: key, omzet: 0, jumlah: 0 };
        }
        rows.filter(r => new Date(r.created_at) >= tiga0Hari).forEach(r => {
            const key = new Date(r.created_at).toISOString().slice(0,10);
            if (perHari[key]) { perHari[key].omzet += r.total||0; perHari[key].jumlah++; }
        });

        // Produk terlaris
        const produkCount = {};
        rows.forEach(r => {
            const items = typeof r.items === 'string' ? JSON.parse(r.items||'[]') : (r.items||[]);
            items.forEach(item => {
                const key = `${item.nama}${item.variasi ? ' - '+item.variasi : ''}`;
                if (!produkCount[key]) produkCount[key] = { nama: key, jumlah: 0, omzet: 0 };
                produkCount[key].jumlah += item.qty || 1;
                produkCount[key].omzet  += (item.harga||0) * (item.qty||1);
            });
        });
        const terlaris = Object.values(produkCount).sort((a,b) => b.jumlah - a.jumlah).slice(0, 10);

        return res.json({
            status: 'ok',
            ringkasan: {
                omzet_hari:   omzetHari,
                omzet_minggu: omzetMinggu,
                omzet_bulan:  omzetBulan,
                omzet_tahun:  omzetTahun,
                omzet_total:  omzetTotal,
                total_transaksi: rows.length,
                transaksi_hari:  rows.filter(r => new Date(r.created_at) >= today).length,
                transaksi_bulan: rows.filter(r => new Date(r.created_at) >= month).length,
            },
            per_hari: Object.values(perHari),
            terlaris
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/public/midtrans/kirim-link — kirim link manual ke pembeli
// ══════════════════════════════════════════════════════════════════
router.post('/midtrans/kirim-link', adminAuth, async (req, res) => {
    const { order_id, link_produk } = req.body || {};
    // link_produk: [{label: "PAG MTK Kelas 7", url: "https://..."}]

    if (!order_id || !link_produk?.length)
        return res.status(400).json({ status: 'error', message: 'order_id dan link_produk wajib diisi.' });

    try {
        // Ambil data order
        const rows = await prisma.$queryRaw`
            SELECT * FROM midtrans_orders WHERE id=${order_id}`;
        if (!rows.length) return res.status(404).json({ status: 'error', message: 'Order tidak ditemukan.' });
        const order = rows[0];

        // Update link_produk di DB
        await prisma.$queryRaw`
            UPDATE midtrans_orders
            SET link_produk=${JSON.stringify(link_produk)}::jsonb, updated_at=now()
            WHERE id=${order_id}`;

        // Buat konten email & WA
        let daftarLinkHtml = '';
        let daftarLinkWA   = '';
        link_produk.forEach((item, i) => {
            const no = i + 1;
            if (item.url) {
                daftarLinkHtml += `<p style="margin:8px 0;"><strong>📌 ${no}. ${item.label}:</strong><br/>
                    <a href="${item.url}" style="color:#1B3A6B;word-break:break-all;">${item.url}</a></p>`;
                daftarLinkWA   += `*${no}. ${item.label}*\n${item.url}\n\n`;
            }
        });

        // Kirim email
        await transporter.sendMail({
            from:    `"Hanun Store" <${process.env.EMAIL_USER}>`,
            to:      order.customer_email,
            subject: `📁 Link Pesanan Anda — ${order_id} | Hanun Store`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#334155;max-width:600px;">
                <div style="background:#1B3A6B;padding:20px;border-radius:10px 10px 0 0;text-align:center;">
                    <h2 style="color:#fff;margin:0;">📁 Link Produk Siap!</h2>
                    <p style="color:#F5A040;margin:4px 0;">Hanun Store</p>
                </div>
                <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;">
                    <p>Assalamu'alaikum, <strong>${order.customer_name}</strong>! 👩‍🏫</p>
                    <p>Berikut link file perangkat ajar pesanan Anda:</p>
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
                        <p style="margin:0 0 8px;font-weight:700;color:#1B3A6B;">📦 No. Pesanan: ${order_id}</p>
                    </div>
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
                        ${daftarLinkHtml}
                    </div>
                    <p style="margin-top:16px;font-size:12px;color:#64748b;">Simpan email ini sebagai bukti. Kendala? WA: <strong>GANTI-NOMOR-WA-ADMIN</strong></p>
                </div>
            </div>`
        }).catch(e => console.error('Email error:', e.message));

        // Kirim WA
        const pesanWA =
            `Halo Kak *${order.customer_name}*! 👩‍🏫\n\n` +
            `Berikut link file perangkat ajar pesanan Anda di *Hanun Store*:\n\n` +
            `📦 No. Pesanan: *${order_id}*\n\n` +
            `📁 *Link File:*\n\n${daftarLinkWA}` +
            `Selamat mengajar! ✨\n_— Hanun Store_`;

        await kirimKeWhatsApp(order.customer_wa, pesanWA);

        return res.json({ status: 'ok', message: 'Link berhasil dikirim ke email dan WhatsApp pembeli.' });
    } catch (e) {
        console.error('Kirim link error:', e.message);
        return res.status(500).json({ status: 'error', message: e.message });
    }
});

module.exports = router;
