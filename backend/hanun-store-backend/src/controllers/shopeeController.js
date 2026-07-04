const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { ambilStatistikPenjualan } = require('../rekapService');

const globalForPrisma = globalThis;
if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL + '&connection_limit=1&pool_timeout=20'
            }
        }
    });
}
const prisma = globalForPrisma.prisma;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FONNTE_TOKEN     = process.env.FONNTE_TOKEN;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function kirimKeTelegram(pesan) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
            { chat_id: TELEGRAM_CHAT_ID, text: pesan, parse_mode: 'HTML' }
        );
    } catch (err) {
        console.error("Gagal kirim Telegram:", err.message);
    }
}

async function kirimKeWhatsApp(nomorHP, pesan) {
    try {
        let nomor = nomorHP.replace(/[^0-9]/g, '');
        if (nomor.startsWith('08')) nomor = '62' + nomor.slice(1);
        await axios.post('https://api.fonnte.com/send',
            { target: nomor, message: pesan, countryCode: '62' },
            { headers: { 'Authorization': FONNTE_TOKEN } }
        );
    } catch (err) {
        console.error("Gagal kirim WA:", err.message);
    }
}

function norm(str) {
    return String(str || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const TAG_KE_CANONICAL = {
    'MTK': 'Matematika', 'MATEMATIKA': 'Matematika',
    'B INDO': 'Bahasa Indonesia', 'BAHASA INDONESIA': 'Bahasa Indonesia', 'BHS INDONESIA': 'Bahasa Indonesia',
    'B INGGRIS': 'Bahasa Inggris', 'BAHASA INGGRIS': 'Bahasa Inggris', 'BHS INGGRIS': 'Bahasa Inggris',
    'PAI': 'PAI', 'PAI & BP': 'PAI', 'PAI&BP': 'PAI',
    'PJOK': 'PJOK',
    'INFOR': 'Informatika', 'INFORMATIKA': 'Informatika',
    'PANCASILA': 'Pancasila', 'PKN': 'Pancasila',
    'S RUPA': 'Seni Rupa', 'SENI RUPA': 'Seni Rupa',
    'S MUSIK': 'Seni Musik', 'SENI MUSIK': 'Seni Musik',
    'S TARI': 'Seni Tari', 'SENI TARI': 'Seni Tari',
    'SENI BUDAYA': 'Seni Budaya', 'SENI': 'Seni Budaya',
    'IPA': 'IPA', 'IPS': 'IPS', 'IPAS': 'IPAS',
    'BIOLOGI': 'Biologi', 'FISIKA': 'Fisika', 'KIMIA': 'Kimia',
    'GEOGRAFI': 'Geografi', 'SOSIOLOGI': 'Sosiologi', 'EKONOMI': 'Ekonomi',
    'SEJARAH': 'Sejarah', 'PRAKARYA': 'Prakarya',
    'AKIDAH A': 'Akidah Akhlak', 'AKIDAH AKHLAK': 'Akidah Akhlak', 'AKIDAH': 'Akidah Akhlak',
    'B ARAB': 'Bahasa Arab', 'BAHASA ARAB': 'Bahasa Arab', 'BHS ARAB': 'Bahasa Arab', 'ARAB': 'Bahasa Arab',
    'FIQIH': 'Fikih', 'FIKIH': 'Fikih',
    'SKI': 'SKI', 'QURDIST': 'Qurdist', 'KKA': 'KKA',
    'BONUS SMA': 'Bonus SMA', 'BONUS': 'Bonus',
};

function terjemahkanMapel(raw) {
    const n = norm(raw);
    if (TAG_KE_CANONICAL[n]) return TAG_KE_CANONICAL[n];
    for (const [alias, label] of Object.entries(TAG_KE_CANONICAL)) {
        if (n.includes(alias) || alias.includes(n)) return label;
    }
    return raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

function getAliasMapel(canonical) {
    const c = norm(canonical);
    const aliases = new Set([c]);
    for (const [alias, label] of Object.entries(TAG_KE_CANONICAL)) {
        if (norm(label) === c) aliases.add(alias);
    }
    return aliases;
}

function cariLinkDiCells(cellsObj, mapelInput, angkaKelas) {
    if (!cellsObj || typeof cellsObj !== 'object') return null;

    const canonical  = terjemahkanMapel(mapelInput);
    const aliasMapel = getAliasMapel(canonical);

    const variasiKelas = new Set();
    if (angkaKelas) {
        const angka = String(angkaKelas).trim();
        variasiKelas.add('KELAS ' + angka);
        variasiKelas.add('KLS ' + angka);
        variasiKelas.add(angka);
        const romawi = { '1':'I','2':'II','3':'III','4':'IV','5':'V','6':'VI','7':'VII','8':'VIII','9':'IX','10':'X','11':'XI','12':'XII' };
        if (romawi[angka]) variasiKelas.add(romawi[angka]);
    } else {
        variasiKelas.add('UMUM');
        variasiKelas.add('SEMUA KELAS');
        variasiKelas.add('');
    }

    for (const [rawKey, url] of Object.entries(cellsObj)) {
        if (!url || url === '#') continue;
        const bagian = rawKey.split('|||');
        if (bagian.length < 2) continue;
        const b0 = norm(bagian[0]);
        const b1 = norm(bagian[1]);
        for (const varKelas of variasiKelas) {
            const kNorm = norm(varKelas);
            for (const aliasM of aliasMapel) {
                const aNorm = norm(aliasM);
                if ((b0 === kNorm && b1 === aNorm) || (b0 === aNorm && b1 === kNorm)) {
                    return url.split('?')[0];
                }
            }
        }
    }
    return null;
}

async function bedahDanCariLink(detailProdukRaw) {
    // Pisah item: support ' | ' (dengan spasi) dan '|' (tanpa spasi)
    const items = detailProdukRaw ? detailProdukRaw.split(/\s*\|\s*/).filter(x => x.trim()) : [];
    const hasil = [];

    let allProducts = [];
    try {
        allProducts = await prisma.product.findMany();
    } catch (dbErr) {
        console.error("Gagal ambil produk dari DB:", dbErr.message);
    }

    for (let rawItem of items) {
        rawItem = rawItem.trim();
        if (!rawItem) continue;

        // 1. Ekstrak Kategori (Kata Pertama) dan Sisanya
        // Contoh: "PAG MTK MERDEKA, 7" -> matchPrefix[1] = "PAG", matchPrefix[2] = "MTK MERDEKA, 7"
        const matchPrefix = rawItem.match(/^([a-zA-Z0-9]+)\s+(.+)/);
        
        if (!matchPrefix) {
            // Jika format teks aneh (tidak ada spasi sama sekali)
            hasil.push({ label: rawItem, url: null, mapel: rawItem, kelas: 'Umum' });
            continue;
        }

        const kategori    = matchPrefix[1].toUpperCase(); // Hasilnya: "PAG", "KBC", "PPT", dll
        const tanpaPrefix = matchPrefix[2].trim();        // Hasilnya: "MTK MERDEKA, 7"

        // 2. KUNCI UTAMA: Filter hanya produk yang namanya mengandung Kategori tersebut!
        // Jika kategori "PAG", ia hanya mencari di Master Produk yang bernama "PAG" atau "Modul PAG"
        const targetProducts = allProducts.filter(p => p.name.toUpperCase().includes(kategori));

        // Cek apakah ada multi-kelas (Format: "MTK MERDEKA, 7 8 9" atau "MTK Kelas 7 8 9")
        const matchMultiKoma  = tanpaPrefix.match(/^(.+?),\s*(\d+(?:\s+\d+)+)$/);
        const matchMultiKelas = tanpaPrefix.match(/^(.+?)\s+[Kk]elas\s+(\d+(?:\s+\d+)+)$/);
        const matchMulti      = matchMultiKoma || matchMultiKelas;

        if (matchMulti) {
            // Proses pemecahan untuk Pesanan Multi-kelas
            const mapelMulti  = matchMulti[1].trim();
            const kelasList   = matchMulti[2].trim().split(/\s+/);
            const mapelFinalM = terjemahkanMapel(mapelMulti);
            
            for (const kls of kelasList) {
                let urlKls = null;
                // HANYA MENCARI DI DALAM PRODUK YANG SUDAH DIFILTER (targetProducts)
                for (const product of targetProducts) {
                    let cellsObj = product.cells;
                    if (typeof cellsObj === 'string') {
                        try { cellsObj = JSON.parse(cellsObj); } catch (e) { continue; }
                    }
                    const link = cariLinkDiCells(cellsObj, mapelMulti, kls);
                    if (link) { urlKls = link; break; }
                }
                
                if (!urlKls) console.warn(`Link tidak ketemu: produk="${kategori}" mapel="${mapelMulti}" kelas="${kls}"`);
                hasil.push({
                    label: `${kategori} ${mapelFinalM} Kelas ${kls}`,
                    url:   urlKls,
                    mapel: mapelFinalM,
                    kelas: kls
                });
            }
            continue; // Lanjut ke item pesanan berikutnya
        }

        // Proses untuk Pesanan Single-kelas
        let mapelRaw, angkaKelas;
        const matchKelas = tanpaPrefix.match(/^(.+?)\s+[Kk]elas\s+(\d+)$/);
        const matchKoma  = tanpaPrefix.match(/^(.+?),\s*(\d+)$/);

        if (matchKelas) {
            mapelRaw   = matchKelas[1].trim();
            angkaKelas = matchKelas[2].trim();
        } else if (matchKoma) {
            mapelRaw   = matchKoma[1].trim();
            angkaKelas = matchKoma[2].trim();
        } else {
            mapelRaw   = tanpaPrefix;
            angkaKelas = null;
        }

        const mapelFinal  = terjemahkanMapel(mapelRaw);
        const labelTampil = angkaKelas ? `${kategori} ${mapelFinal} Kelas ${angkaKelas}` : `${kategori} ${mapelFinal}`;

        let urlKetemu = null;
        // HANYA MENCARI DI DALAM PRODUK YANG SUDAH DIFILTER (targetProducts)
        for (const product of targetProducts) {
            let cellsObj = product.cells;
            if (typeof cellsObj === 'string') {
                try { cellsObj = JSON.parse(cellsObj); } catch (e) { continue; }
            }
            const link = cariLinkDiCells(cellsObj, mapelRaw, angkaKelas);
            if (link) { urlKetemu = link; break; }
        }

        if (!urlKetemu) console.warn(`Link tidak ketemu: produk="${kategori}" mapel="${mapelRaw}" kelas="${angkaKelas}"`);

        hasil.push({ label: labelTampil, url: urlKetemu, mapel: mapelFinal, kelas: angkaKelas || 'Umum' });
    }

    return hasil;
}

function buatTemplate(order, hasilProduk) {
    let template =
        `[KIRIM EMAIL]\n` +
        `No Pesanan: ${order.no_pesanan}\n` +
        `Pembeli: ${order.username_pembeli}\n` +
        `Email: \n` +
        `WA : `;

    hasilProduk.forEach((item, i) => {
        template += `\nproduk ${i + 1} : ${item.label}`;
        template += `\nlink: ${item.url || ''}`;  // kosong jika tidak ketemu → isi manual
    });

    return template;
}

function parseTemplateKirimEmail(textRaw) {
    const matchNoPesanan = textRaw.match(/No Pesanan:\s*([^\n\r]+)/i);
    const matchPembeli   = textRaw.match(/Pembeli:\s*([^\n\r]+)/i);
    const matchEmail     = textRaw.match(/Email:\s*([^\n\r]+)/i);
    const matchWA        = textRaw.match(/WA\s*:\s*([^\n\r]+)/i);

    const noPesanan = matchNoPesanan ? matchNoPesanan[1].trim() : null;
    const pembeli   = matchPembeli   ? matchPembeli[1].trim()   : 'Bapak/Ibu Guru';

    const emailBaris = matchEmail ? matchEmail[1].trim() : '';
    const emailMatch = emailBaris.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    const email      = emailMatch ? emailMatch[1].trim() : null;

    const waBaris = matchWA ? matchWA[1].trim() : '';
    const waMatch = waBaris.match(/(628\d{9,12}|08\d{9,12})/);
    const wa      = waMatch ? waMatch[1].trim() : null;

    const produkList = [];
    const produkRegex = /produk\s+\d+\s*:\s*([^\n\r]+)\nlink:\s*([^\n\r]*)/gi;
    let m;
    while ((m = produkRegex.exec(textRaw)) !== null) {
        const label    = m[1].trim();
        const urlRaw   = m[2].trim();
        const urlValid = (urlRaw && urlRaw.startsWith('http')) ? urlRaw : null;
        produkList.push({ label, url: urlValid });
    }

    return { noPesanan, pembeli, email, wa, produkList };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALISASI PREFIX KATEGORI — KHUSUS JALUR SHOPEE
// Variasi dari email Shopee sering datang tanpa tag kategori (mis. "mtk,1"),
// padahal bedahDanCariLink butuh "<KATEGORI> mapel,kelas" (mis. "PAG mtk,1")
// untuk tahu produk mana yang dicari.
// Aturan: kalau token pertama tiap item SUDAH cocok dengan salah satu
// products.name (tes yang sama dengan matcher di bedahDanCariLink), biarkan;
// kalau tidak, tempel DEFAULT_KATEGORI_SHOPEE di depan. Jalur Web/Midtrans
// TIDAK memakai fungsi ini, jadi tidak tersentuh.
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_KATEGORI_SHOPEE = 'PAG';

async function tambahPrefixKategoriShopee(detailProdukRaw) {
    if (!detailProdukRaw) return detailProdukRaw;

    let allProducts;
    try {
        allProducts = await prisma.product.findMany();
    } catch (dbErr) {
        // DB gagal → jangan paksa prefix (bisa salah untuk item non-default seperti
        // KBC) → kembalikan apa adanya biar tidak merusak data.
        console.error('tambahPrefixKategoriShopee: gagal ambil produk:', dbErr.message);
        return detailProdukRaw;
    }

    return detailProdukRaw
        .split(/\s*\|\s*/)
        .filter(x => x.trim())
        .map(item => {
            item = item.trim();
            const tokenPertama = (item.match(/^([a-zA-Z0-9]+)/) || [])[1] || '';
            const sudahKategori = tokenPertama &&
                allProducts.some(p => (p.name || '').toUpperCase().includes(tokenPertama.toUpperCase()));
            return sudahKategori ? item : `${DEFAULT_KATEGORI_SHOPEE} ${item}`;
        })
        .join(' | ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 1] WEBHOOK — Penerima data pesanan dari GAS
// ═══════════════════════════════════════════════════════════════════════════════
exports.handleShopeeEmailWebhook = async (req, res) => {
    const orderData = req.body;

    if (!orderData || !orderData.no_pesanan) {
        return res.status(400).json({ status: "error", message: "Data tidak lengkap" });
    }

    try {
        // Normalisasi prefix kategori KHUSUS Shopee (jalur Web tidak tersentuh):
        // variasi tanpa tag (mis. "mtk,1") ditempeli "PAG" → "PAG mtk,1".
        const detailNormal = await tambahPrefixKategoriShopee(orderData.detail_produk);
        const hasilProduk = await bedahDanCariLink(detailNormal);

        const rekapDetail = hasilProduk
            .map(item => item.url ? `${item.label} (${item.url})` : item.label)
            .join(' | ');

        await prisma.shopeeOrder.upsert({
            where:  { no_pesanan: orderData.no_pesanan },
            update: { status_aksi: orderData.status_aksi, username_pembeli: orderData.username_pembeli, detail_produk: rekapDetail },
            create: { no_pesanan: orderData.no_pesanan, waktu: new Date(), username_pembeli: orderData.username_pembeli, status_aksi: orderData.status_aksi, nominal: orderData.nominal || 0, detail_produk: rekapDetail, id_transaksi: "Menunggu Info" }
        });

        const statusBaru = ['BARU_DITERIMA', 'PEMBAYARAN_VALID'];
        if (statusBaru.includes(orderData.status_aksi)) {
            const infoProduk = hasilProduk.map(item =>
                item.url ? `• ✅ ${item.label}` : `• ❓ ${item.label} <i>(link belum ada di DB)</i>`
            ).join('\n');

            const nominal = orderData.nominal ? `Rp ${Number(orderData.nominal).toLocaleString('id-ID')}` : '-';

            await kirimKeTelegram(
                `🟢 <b>PESANAN BARU MASUK!</b>\n\n` +
                `🛒 <b>No:</b> <code>${orderData.no_pesanan}</code>\n` +
                `👤 <b>Pembeli:</b> ${orderData.username_pembeli}\n` +
                `💰 <b>Nominal:</b> ${nominal}\n` +
                `📦 <b>Produk:</b>\n${infoProduk}\n\n` +
                `<i>Ketik nomor pesanan untuk kirim email 👆</i>`
            );
        }

        return res.status(200).json({ status: "success" });

    } catch (error) {
        console.error("Webhook Shopee Error:", error.message);
        return res.status(500).json({ status: "error", message: error.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 2] WEBHOOK INTERAKTIF TELEGRAM
// PENTING: res.send() hanya dipanggil SETELAH semua proses selesai.
// Jika dipanggil lebih awal, Vercel mematikan function sebelum pesan terkirim.
// ═══════════════════════════════════════════════════════════════════════════════
exports.handleTelegramInteractiveWebhook = async (req, res) => {
    const webhookData = req.body;

    if (!webhookData || !webhookData.message) {
        return res.status(200).send('OK');
    }

    const senderChatId  = String(webhookData.message.chat.id);
    const textRaw       = webhookData.message.text ? webhookData.message.text.trim() : '';
    const allowedChatId = String(TELEGRAM_CHAT_ID).trim();

    if (senderChatId !== allowedChatId) {
        return res.status(200).send('OK');
    }

    try {
        const textLower = textRaw.toLowerCase();

        // ── PERINTAH: pesanan ──────────────────────────────────────────
        if (textLower === 'pesanan') {
            const hariIni = new Date();
            hariIni.setHours(0, 0, 0, 0);
            const orders = await prisma.shopeeOrder.findMany({
                where: { waktu: { gte: hariIni }, status_aksi: { in: ['BARU_DITERIMA', 'PEMBAYARAN_VALID'] } },
                orderBy: { waktu: 'desc' }
            });

            if (orders.length === 0) {
                await kirimKeTelegram("📋 <b>PESANAN HARI INI</b>\nBelum ada pesanan baru. Tetap semangat! 🚀");
            } else {
                const tgl = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
                let laporan = `📋 <b>PESANAN HARI INI (${tgl})</b>\n\n`;
                orders.forEach((o, i) => {
                    const produkClean = o.detail_produk.replace(/\s\(https[^)]+\)/g, '');
                    laporan += `${i + 1}. 🛒 <code>${o.no_pesanan}</code>\n   👤 ${o.username_pembeli}\n   └ ${produkClean}\n\n`;
                });
                laporan += `<i>Ketik nomor pesanan untuk kirim email.</i>`;
                await kirimKeTelegram(laporan);
            }

        // ── PERINTAH: rekap hari ───────────────────────────────────────
        } else if (textLower === 'rekap hari') {
            const awal = new Date(); awal.setHours(0, 0, 0, 0);
            const akhir = new Date(); akhir.setHours(23, 59, 59, 999);
            const laporan = await ambilStatistikPenjualan(awal, akhir);
            await kirimKeTelegram(`📅 <b>REKAP HARI INI</b>\n\n` + laporan);

        // ── PERINTAH: rekap minggu ─────────────────────────────────────
        } else if (textLower === 'rekap minggu') {
            const sekarang = new Date();
            const tujuhHariLalu = new Date();
            tujuhHariLalu.setDate(sekarang.getDate() - 7);
            tujuhHariLalu.setHours(0, 0, 0, 0);
            const laporan  = await ambilStatistikPenjualan(tujuhHariLalu, sekarang);
            const tglMulai = tujuhHariLalu.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
            const tglAkhir = sekarang.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            await kirimKeTelegram(`📅 <b>REKAP MINGGUAN (${tglMulai} s/d ${tglAkhir})</b>\n\n` + laporan);

        // ── SKENARIO: [KIRIM EMAIL] ────────────────────────────────────
        } else if (textRaw.startsWith('[KIRIM EMAIL]')) {
            const { noPesanan, pembeli, email, wa, produkList } = parseTemplateKirimEmail(textRaw);

            if (!email) {
                await kirimKeTelegram("❌ <b>Gagal:</b> Email belum diisi atau formatnya salah!\n\nContoh:\n<code>Email: guru@gmail.com</code>");
                return res.status(200).send('OK');
            }
            if (!noPesanan) {
                await kirimKeTelegram("❌ <b>Gagal:</b> Nomor pesanan tidak terbaca!");
                return res.status(200).send('OK');
            }
            if (produkList.length === 0) {
                await kirimKeTelegram("❌ <b>Gagal:</b> Format produk tidak terbaca. Jangan ubah baris 'produk N :' dan 'link:'");
                return res.status(200).send('OK');
            }

            const order = await prisma.shopeeOrder.findUnique({ where: { no_pesanan: noPesanan } });
            if (!order) {
                await kirimKeTelegram(`❌ Pesanan <code>${noPesanan}</code> tidak ditemukan di database.`);
                return res.status(200).send('OK');
            }

            let daftarLinkHtml = '';
            let daftarLinkWA   = '';
            let adaLinkKosong  = false;

            produkList.forEach((item, i) => {
                const no = i + 1;
                if (item.url) {
                    daftarLinkHtml += `<p style='margin:8px 0;'><strong>📌 ${no}. ${item.label}:</strong><br/><a href='${item.url}' style='color:#4f46e5;word-break:break-all;'>${item.url}</a></p>`;
                    daftarLinkWA   += `*${no}. ${item.label}*\n${item.url}\n\n`;
                } else {
                    adaLinkKosong = true;
                    daftarLinkHtml += `<p style='margin:8px 0;color:#ef4444;'>⚠️ ${no}. ${item.label}: <em>Link belum tersedia</em></p>`;
                    daftarLinkWA   += `*${no}. ${item.label}*\n(link menyusul)\n\n`;
                }
            });

            await transporter.sendMail({
                from:    `"Hanun Store" <${process.env.EMAIL_USER}>`,
                to:      email,
                subject: `📦 [Hanun Store] Akses Link Download Perangkat Ajar`,
                html: `<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#334155;max-width:600px;'>
                    <p>Assalamu'alaikum, ${pembeli}! 👩‍🏫👨‍🏫</p>
                    <p>Terima kasih telah mempercayai <strong>Hanun Store</strong>. Berikut link file perangkat ajar yang Anda pesan:</p>
                    <div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>${daftarLinkHtml}</div>
                    <p><strong>📁 Keterangan Penting:</strong><br>
                    • MOHON KLIK PESANAN DITERIMA SETELAH 1X24 JAM<br>
                    • Mohon berikan ulasan bintang 5 untuk mendukung kami 🌟<br>
                    • Perangkat Ajar Lengkap (1 Tahun / 2 Semester)<br>
                    • Format Word &amp; PPT · Sudah Deep Learning<br>
                    • Kendala? Hubungi WA Admin: <strong>GANTI-NOMOR-WA-ADMIN</strong></p>
                    <p style='color:#64748b;font-size:12px;margin-top:24px;'>— Salam Hangat, Hanun Store</p>
                </div>`
            });

            if (wa) {
                const pesanWA =
                    `Halo Kak *${pembeli}*! 👩‍🏫\n\n` +
                    `Terima kasih sudah berbelanja di *Hanun Store*! 🙏\n\n` +
                    `Berikut link Perangkat Ajar yang Kakak pesan:\n\n${daftarLinkWA}` +
                    `📋 *Keterangan Penting:*\n• Klik Pesanan Diterima setelah 1x24 jam\n• Berikan ulasan bintang 5 ya Kak 🌟\n• Kendala? Balas WA ini langsung!\n\nSelamat mengajar! ✨`;
                await kirimKeWhatsApp(wa, pesanWA);
            }

            await prisma.shopeeOrder.update({
                where: { no_pesanan: noPesanan },
                data:  { status_aksi: 'TERKIRIM' }
            });

            const infoWA      = wa ? ` & WA ke <code>${wa}</code>` : '';
            const warningLink = adaLinkKosong ? `\n⚠️ <b>Ada produk yang linknya kosong!</b>` : '';
            await kirimKeTelegram(
                `✅ <b>Email berhasil dikirim!</b>\n` +
                `📧 Ke: <code>${email}</code>${infoWA}\n` +
                `📦 Pesanan: <code>${noPesanan}</code>\n` +
                `Status: TERKIRIM${warningLink}`
            );

        // ── SKENARIO: ketik nomor pesanan ──────────────────────────────
        } else if (/^[A-Z0-9]{10,20}$/i.test(textRaw)) {
            const targetNoPesanan = textRaw.toUpperCase();

            const order = await prisma.shopeeOrder.findUnique({ where: { no_pesanan: targetNoPesanan } });
            if (!order) {
                await kirimKeTelegram(`❌ Nomor pesanan <code>${targetNoPesanan}</code> tidak ditemukan.`);
                return res.status(200).send('OK');
            }

            const produkMentah = order.detail_produk.replace(/\s\(https[^)]+\)/g, '');
            const hasilProduk  = await bedahDanCariLink(produkMentah);
            const adaKosong    = hasilProduk.some(p => !p.url);

            const infoProduk = hasilProduk.map(item =>
                item.url ? `✅ ${item.label}` : `❌ ${item.label} (isi link manual)`
            ).join('\n');

            await kirimKeTelegram(
                `📋 <b>Pesanan Ditemukan!</b>\n\n` +
                `🛒 No: <code>${order.no_pesanan}</code>\n` +
                `👤 Pembeli: ${order.username_pembeli}\n\n` +
                `<b>Status Link:</b>\n${infoProduk}\n\n` +
                (adaKosong ? `⚠️ <i>Beberapa link kosong, isi manual di template.</i>\n\n` : ``) +
                `<i>Salin template di bawah → isi Email → kirim balik:</i>`
            );

            await kirimKeTelegram(buatTemplate(order, hasilProduk));
        }

    } catch (err) {
        console.error("Error bot Telegram:", err.message);
        await kirimKeTelegram(`❌ <b>System Error:</b> ${err.message}`);
    }

    // res.send() selalu di paling akhir — setelah semua await selesai
    return res.status(200).send('OK');
};

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 3] API DASHBOARD — Mengirim data ke Frontend HTML
// ═══════════════════════════════════════════════════════════════════════════════
exports.getDashboardData = async (req, res) => {
    try {
        // 1. Ambil semua data pesanan
        const orders = await prisma.shopeeOrder.findMany({
            orderBy: { waktu: 'desc' }
        });

        // 2. Ambil semua data master produk
        const products = await prisma.product.findMany();

        // 3. Format & "Terjemahkan" Status
        const formattedOrders = orders.map(o => {
            let statusCocok = o.status_aksi;
            
            // Terjemahkan status dari bahasa Database ke bahasa Frontend Dashboard
            if (statusCocok === 'TERKIRIM') {
                statusCocok = 'SELESAI';
            } else if (statusCocok === 'BARU_DITERIMA') {
                statusCocok = 'PEMBAYARAN_VALID';
            }

            return {
                id: o.no_pesanan,
                waktu: o.waktu,
                no_pesanan: o.no_pesanan,
                username: o.username_pembeli,
                status_aksi: statusCocok, // <-- Status sudah diterjemahkan
                nominal: o.nominal,
                produk: o.detail_produk 
            };
        });

        // 4. Kirim sebagai JSON
        return res.status(200).json({
            success: true,
            orders: formattedOrders,
            products: products
        });

    } catch (error) {
        console.error("❌ Gagal mengambil data dashboard:", error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 3] CRUD PRODUK
// ═══════════════════════════════════════════════════════════════════════════════

// GET semua produk
exports.getAllProducts = async (req, res) => {
    try {
        const products = await prisma.product.findMany();
        return res.status(200).json({ success: true, products });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// POST buat produk baru
exports.createProduct = async (req, res) => {
    const { id, name, accent, dim1, dim2, cells } = req.body;
    if (!id || !name) return res.status(400).json({ success: false, message: 'id dan name wajib diisi' });
    try {
        const product = await prisma.product.create({
            data: { id, name, accent: accent || '99 102 241', dim1: dim1 || {}, dim2: dim2 || {}, cells: cells || {} }
        });
        return res.status(201).json({ success: true, product });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// PUT update produk (termasuk update cells/link)
exports.updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, accent, dim1, dim2, cells } = req.body;
    try {
        const product = await prisma.product.update({
            where: { id },
            data: { name, accent, dim1, dim2, cells }
        });
        return res.status(200).json({ success: true, product });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// DELETE produk
exports.deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.product.delete({ where: { id } });
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 4] KIRIM EMAIL MANUAL dari Dashboard
// POST /api/kirim-email
// Body: { no_pesanan, email, wa, produkList: [{label, url}], pembeli }
// ═══════════════════════════════════════════════════════════════════════════════
exports.kirimEmailManual = async (req, res) => {
    const { no_pesanan, email, wa, produkList, pembeli } = req.body;

    if (!email || !no_pesanan || !produkList || produkList.length === 0) {
        return res.status(400).json({ success: false, message: 'email, no_pesanan, dan produkList wajib diisi' });
    }

    try {
        let daftarLinkHtml = '';
        let daftarLinkWA   = '';
        let adaKosong      = false;

        produkList.forEach((item, i) => {
            const no = i + 1;
            if (item.url) {
                daftarLinkHtml += `<p style='margin:8px 0;'><strong>📌 ${no}. ${item.label}:</strong><br/><a href='${item.url}' style='color:#4f46e5;word-break:break-all;'>${item.url}</a></p>`;
                daftarLinkWA   += `*${no}. ${item.label}*\n${item.url}\n\n`;
            } else {
                adaKosong = true;
                daftarLinkHtml += `<p style='margin:8px 0;color:#ef4444;'>⚠️ ${no}. ${item.label}: <em>Link belum tersedia</em></p>`;
                daftarLinkWA   += `*${no}. ${item.label}*\n(link menyusul)\n\n`;
            }
        });

        await transporter.sendMail({
            from:    `"Hanun Store" <${process.env.EMAIL_USER}>`,
            to:      email,
            subject: `📦 [Hanun Store] Akses Link Download Perangkat Ajar`,
            html: `<div style='font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#334155;max-width:600px;'>
                <p>Assalamu'alaikum, ${pembeli || 'Bapak/Ibu Guru'}! 👩‍🏫👨‍🏫</p>
                <p>Terima kasih telah mempercayai <strong>Hanun Store</strong>. Berikut link file perangkat ajar yang Anda pesan:</p>
                <div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>${daftarLinkHtml}</div>
                <p><strong>📁 Keterangan Penting:</strong><br>
                • MOHON KLIK PESANAN DITERIMA SETELAH 1X24 JAM<br>
                • Mohon berikan ulasan bintang 5 untuk mendukung kami 🌟<br>
                • Perangkat Ajar Lengkap (1 Tahun / 2 Semester)<br>
                • Format Word &amp; PPT · Sudah Deep Learning<br>
                • Kendala? Hubungi WA Admin: <strong>GANTI-NOMOR-WA-ADMIN</strong></p>
                <p style='color:#64748b;font-size:12px;margin-top:24px;'>— Salam Hangat, Hanun Store</p>
            </div>`
        });

        if (wa) {
            let nomor = wa.replace(/[^0-9]/g, '');
            if (nomor.startsWith('08')) nomor = '62' + nomor.slice(1);
            const pesanWA =
                `Halo Kak *${pembeli || 'Guru'}*! 👩‍🏫\n\nTerima kasih sudah berbelanja di *Hanun Store*! 🙏\n\nBerikut link Perangkat Ajar yang Kakak pesan:\n\n${daftarLinkWA}` +
                `📋 *Keterangan Penting:*\n• Klik Pesanan Diterima setelah 1x24 jam\n• Berikan ulasan bintang 5 ya Kak 🌟\n• Kendala? Balas WA ini langsung!\n\nSelamat mengajar! ✨`;
            await axios.post('https://api.fonnte.com/send',
                { target: nomor, message: pesanWA, countryCode: '62' },
                { headers: { 'Authorization': FONNTE_TOKEN } }
            );
        }

        // Update status pesanan jadi TERKIRIM
        await prisma.shopeeOrder.update({
            where: { no_pesanan },
            data:  { status_aksi: 'TERKIRIM' }
        });

        return res.status(200).json({ success: true, adaKosong });

    } catch (err) {
        console.error('kirimEmailManual error:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 5] CARI LINK OTOMATIS untuk pesanan tertentu
// POST /api/cari-link  body: { detail_produk }
// ═══════════════════════════════════════════════════════════════════════════════
exports.cariLinkOtomatis = async (req, res) => {
    const { detail_produk } = req.body;
    if (!detail_produk) return res.status(400).json({ success: false, message: 'detail_produk wajib diisi' });
    try {
        const hasil = await bedahDanCariLink(detail_produk);
        return res.status(200).json({ success: true, produkList: hasil });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// [ROUTE 6] UBAH STATUS & HAPUS PESANAN dari Dashboard
// PATCH  /api/orders/:no_pesanan  body: { status_aksi }
// DELETE /api/orders/:no_pesanan
// ═══════════════════════════════════════════════════════════════════════════════

// Dashboard memakai kosakata status hasil terjemahan (lihat getDashboardData).
// Untuk menulis balik ke DB, map ke kosakata internal DB.
const STATUS_FE_KE_DB = {
    'SELESAI':          'TERKIRIM',
    'PEMBAYARAN_VALID': 'BARU_DITERIMA',
    'DIBATALKAN':       'DIBATALKAN',
    'PENGEMBALIAN':     'PENGEMBALIAN'
};

exports.updateOrderStatus = async (req, res) => {
    const { no_pesanan } = req.params;
    const { status_aksi } = req.body || {};
    const dbStatus = STATUS_FE_KE_DB[status_aksi];
    if (!dbStatus) return res.status(400).json({ success: false, message: 'Status tidak valid' });
    try {
        await prisma.shopeeOrder.update({ where: { no_pesanan }, data: { status_aksi: dbStatus } });
        return res.status(200).json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteOrder = async (req, res) => {
    const { no_pesanan } = req.params;
    try {
        await prisma.shopeeOrder.delete({ where: { no_pesanan } });
        return res.status(200).json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Export pencari link "kuat" (dengan kamus alias mapel + angka romawi, dst)
// agar bisa dipakai ulang oleh publicRoutes.js (webhook Midtrans & endpoint
// cari-link) — menggantikan implementasi lemah yang gagal mencocokkan
// beberapa mapel seperti "B INDONESIA" -> "Bahasa Indonesia".
exports.bedahDanCariLink = bedahDanCariLink;