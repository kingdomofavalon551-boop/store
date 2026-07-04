# Hanun Store Admin — Dashboard

## Cara Deploy ke Vercel

### Langkah 1: Siapkan folder
Buat folder baru bernama `hanun-store-admin` dan masukkan semua file ini:
```
hanun-store-admin/
├── index.html       ← dashboard utama
├── manifest.json    ← config PWA
├── sw.js            ← service worker
├── vercel.json      ← config Vercel
├── icon-192.png     ← icon app (buat dari generate-icon.html)
└── icon-512.png     ← icon app besar
```

### Langkah 2: Buat icon
Buka `generate-icon.html` di browser → icon akan otomatis terdownload (icon-192.png & icon-512.png)

### Langkah 3: Deploy ke Vercel
Opsi A — Via GitHub (Rekomendasi):
1. Push folder ke GitHub repo baru
2. Buka vercel.com → New Project → Import repo tersebut
3. Framework: Other, Root: / → Deploy

Opsi B — Via Vercel CLI:
```bash
npm i -g vercel
cd hanun-store-admin
vercel --prod
```

### Langkah 4: Install sebagai aplikasi mobile
**Android (Chrome):**
Buka URL dashboard → Menu (⋮) → "Add to Home Screen" → Install

**iPhone (Safari):**
Buka URL dashboard → Share button → "Add to Home Screen" → Add

---
Domain yang akan didapat: `hanun-store-frontend.vercel.app` (atau custom domain)
