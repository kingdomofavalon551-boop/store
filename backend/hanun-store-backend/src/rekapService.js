// rekapService.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Utilitas untuk menghitung statistik penjualan (Rekap)
 * @param {Date} waktuMulai - Batas awal waktu pencarian
 * @param {Date} waktuSelesai - Batas akhir waktu pencarian
 * @returns {String} Teks laporan berformat HTML untuk Telegram
 */
async function ambilStatistikPenjualan(waktuMulai, waktuSelesai) {
    try {
        // 1. Ambil semua pesanan yang statusnya 'TERKIRIM' dalam rentang waktu tersebut
        const orders = await prisma.shopeeOrder.findMany({
            where: {
                waktu: {
                    gte: waktuMulai,
                    lte: waktuSelesai
                },
                status_aksi: 'TERKIRIM' // Hanya menghitung pesanan yang sudah berhasil dikirim
            }
        });

        // Jika tidak ada pesanan di rentang waktu tersebut
        if (orders.length === 0) {
            return "📊 <b>REKAP PENJUALAN</b>\nBelum ada transaksi sukses dalam periode ini. Tetap semangat! 🚀";
        }

        // 2. Hitung jumlah pembeli unik (menghilangkan duplikasi jika pembeli sama order 2 kali)
        const arrayPembeli = orders.map(o => o.username_pembeli ? o.username_pembeli.trim() : 'Anonim');
        const pembeliUnik = new Set(arrayPembeli).size;

        // 3. Hitung total pendapatan dan total jumlah produk
        let totalPendapatan = 0;
        let totalProduk = 0;

        orders.forEach(o => {
            // Tambahkan nominal uang
            totalPendapatan += o.nominal || 0;
            
            // Hitung jumlah item produk berdasarkan pemisah karakter '|'
            if (o.detail_produk) {
                const jmlItem = o.detail_produk.split('|').length;
                totalProduk += jmlItem;
            }
        });

        // 4. Susun teks laporan
        let laporan = `📊 <b>REKAP PENJUALAN HANUN STORE</b>\n` +
                      `━━━━━━━━━━━━━━━━━━━\n` +
                      `👤 <b>Jumlah Pembeli:</b> ${pembeliUnik} Orang\n` +
                      `📦 <b>Produk Terjual:</b> ${totalProduk} File Perangkat Ajar\n` +
                      `💰 <b>Total Pendapatan:</b> Rp ${totalPendapatan.toLocaleString('id-ID')}\n` +
                      `━━━━━━━━━━━━━━━━━━━\n` +
                      `<i>Data ditarik secara otomatis dari sistem database.</i>`;
                      
        return laporan;

    } catch (error) {
        console.error("❌ Database Error (rekapService):", error.message);
        return `❌ <b>Gagal mengambil data rekap:</b> ${error.message}`;
    }
}

// Ekspor fungsi agar bisa dipanggil dari file lain
module.exports = {
    ambilStatistikPenjualan
};