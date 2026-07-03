const express = require('express');
const router = express.Router();
const shopeeController = require('../controllers/shopeeController');

// ── Verifikasi shared-secret webhook ──────────────────────────────
// Opt-in: hanya aktif kalau env var terkait sudah di-set, supaya webhook
// GAS/Telegram yang sedang berjalan produksi tidak langsung putus saat
// deploy. Untuk mengaktifkan proteksi:
//   1. Set GAS_WEBHOOK_SECRET di Vercel, lalu kirim header
//      x-webhook-secret: <nilai> dari skrip Google Apps Script.
//   2. Set TELEGRAM_WEBHOOK_SECRET di Vercel, lalu daftarkan ulang
//      webhook Telegram dengan parameter secret_token bernilai sama:
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=<url>&secret_token=<TELEGRAM_WEBHOOK_SECRET>
function verifyWebhookSecret(envName, headerName) {
    return (req, res, next) => {
        const expected = process.env[envName];
        if (!expected) return next(); // belum dikonfigurasi -> perilaku lama, tidak diblokir
        const got = req.headers[headerName];
        if (got !== expected) return res.status(200).send('OK'); // diam-diam tolak, tidak bocorkan info & tidak memicu retry
        next();
    };
}

// ── Proteksi endpoint dashboard admin ─────────────────────────────
// Endpoint di bawah ini (data pesanan, CRUD produk, kirim email) sebelumnya
// tidak punya autentikasi sama sekali - siapa pun yang tahu URL bisa baca
// data pesanan, hapus produk, atau trigger kirim email ke email manapun.
// Pakai secret yang sama dengan adminAuth di publicRoutes.js supaya tidak
// perlu env var baru: set ADMIN_SECRET di Vercel, dashboard mengirim
// header x-admin-secret di setiap request.
function adminAuth(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    const token  = req.headers['x-admin-secret'] || req.query.secret;
    if (!secret || !token || token !== secret) return res.status(401).json({ status: 'unauthorized' });
    next();
}

// Webhook
router.post('/shopee-webhook',
    verifyWebhookSecret('GAS_WEBHOOK_SECRET', 'x-webhook-secret'),
    shopeeController.handleShopeeEmailWebhook);
router.post('/telegram-webhook',
    verifyWebhookSecret('TELEGRAM_WEBHOOK_SECRET', 'x-telegram-bot-api-secret-token'),
    shopeeController.handleTelegramInteractiveWebhook);

// Dashboard data
router.get('/exec', adminAuth, shopeeController.getDashboardData);

// CRUD Produk
router.get('/products',         adminAuth, shopeeController.getAllProducts);
router.post('/products',        adminAuth, shopeeController.createProduct);
router.put('/products/:id',     adminAuth, shopeeController.updateProduct);
router.delete('/products/:id',  adminAuth, shopeeController.deleteProduct);

// Kirim email dari dashboard
router.post('/kirim-email',     adminAuth, shopeeController.kirimEmailManual);
router.post('/cari-link',       adminAuth, shopeeController.cariLinkOtomatis);

// Ubah status & hapus pesanan Shopee dari dashboard
router.patch('/orders/:no_pesanan',  adminAuth, shopeeController.updateOrderStatus);
router.delete('/orders/:no_pesanan', adminAuth, shopeeController.deleteOrder);

module.exports = router;