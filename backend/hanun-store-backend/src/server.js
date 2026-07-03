require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Dibutuhkan untuk menembak API Telegram dari sini

// Import Routing & Service
const apiRoutes = require('./routes/api');
const { ambilStatistikPenjualan } = require('./rekapService'); // Pastikan path ini sesuai dengan lokasi file Anda

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// CORS: opt-in restriction lewat ALLOWED_ORIGINS (pisahkan koma jika lebih dari satu).
// Kalau belum di-set, perilaku lama tetap jalan (semua origin diizinkan) supaya
// deploy yang sudah berjalan tidak mendadak putus.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json()); // Sangat krusial untuk menangkap payload JSON
app.use(express.urlencoded({ extended: true }));

// Endpoint Tes Koneksi
app.get('/', (req, res) => {
    res.send('🚀 Backend Hanun Store Webhook Server Aktif!');
});

// =====================================================================
// ENDPOINT CRON JOB (Otomatis dieksekusi Vercel jam 10.30 WIB)
// =====================================================================
app.get('/api/cron-rekap', async (req, res) => {
    try {
        const awalHari = new Date();
        awalHari.setHours(0, 0, 0, 0);
        
        const jamSekarang = new Date(); // Waktu saat cron berjalan

        // 1. Ambil teks laporan dari service yang sudah kita buat
        const laporanHariIni = await ambilStatistikPenjualan(awalHari, jamSekarang);
        
        // 2. Tambahkan header penanda bahwa ini adalah rekap otomatis
        const pesanTelegram = `⏰ <b>REKAP HARIAN OTOMATIS (10.30 WIB)</b>\n\n${laporanHariIni}`;

        // 3. Tembak langsung ke Telegram Anda
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: pesanTelegram,
            parse_mode: 'HTML'
        });

        console.log("✅ Cron Job berhasil dieksekusi dan dikirim ke Telegram.");
        return res.status(200).send('Cron job berhasil dijalankan');
    } catch (error) {
        console.error("❌ Cron Job gagal:", error.message);
        return res.status(500).send(`Gagal: ${error.message}`);
    }
});

// Routing Utama (Untuk Webhook Shopee & Telegram Interactive)
app.use('/api', apiRoutes);

const publicRoutes = require('./routes/publicRoutes');
app.use('/api/public', publicRoutes);

// Menyalakan Mesin Server (Berguna saat testing di lokal / komputer sendiri)
app.listen(PORT, () => {
    console.log(`🚀 Server menyala dengan performa tinggi di http://localhost:${PORT}`);
});

// =====================================================================
// SANGAT KRUSIAL UNTUK VERCEL: Export aplikasi Express
// =====================================================================
module.exports = app;