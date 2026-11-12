# Domino Match Manager

Aplikasi web untuk mengelola sesi main domino bersama: giliran pemain, antrean, skor, klasemen, dan rekap. Berjalan sepenuhnya di browser, tanpa server dan tanpa akun.

## Fitur

- **Match dua ronde.** Empat pemain yang sama memainkan dua ronde. Poin dijumlahkan, lalu pemain dengan poin match terendah diganti pemain dari antrean.
- **Antrean dan break.** Pemain yang keluar masuk ke belakang antrean. Pemain bisa diistirahatkan (break) dan dilanjutkan lagi kapan saja.
- **Battle Arena.** Kalau poin seri menentukan siapa yang keluar, tiap pemain menarik satu kartu domino tertutup. Sebelum kartu dibuka ada hitung mundur 3-2-1, lalu kartu terbuka satu per satu dan pemenang seri menyala.
- **Klasemen ganda.** Klasemen match yang sedang berjalan dan klasemen keseluruhan, lengkap dengan win rate.
- **Streak dan gelar.** Win/lose streak dihitung otomatis dari juara 1 tiap ronde. Gelar tampil di samping nama; daftar lengkapnya ada di menu *Streak & gelar pemain*.
- **Timer sesi** dengan mulai, jeda, dan restart.
- **Riwayat dan undo.** Semua ronde tercatat, ronde terakhir bisa dibatalkan.
- **Rekap sesi** yang bisa dibagikan sebagai gambar.
- **Cadangan data.** Ekspor dan impor JSON.
- **Mode terang dan gelap**, dirancang untuk dipakai dari HP.

## Aturan poin

| Peringkat | Poin |
|---|---|
| Juara 1 | +4 atau +5 |
| Juara 2 | +3 |
| Juara 3 | +2 |
| Juara 4 | +1 atau -1 |

Jumlah pemain yang diganti mengikuti peserta siap main: 5 orang = 1 pemain, 6 orang = 2 pemain, 7 orang = 3 pemain.

## Cara pakai

1. Tambahkan minimal 4 pemain di panel *Antrean pemain*.
2. Isi nama sesi (opsional), lalu tekan **Mulai sesi**.
3. Di setiap ronde, pilih peringkat 1 sampai 4 untuk tiap pemain, lalu **Simpan hasil ronde**.
4. Setelah ronde kedua, pemain dengan poin match terendah diganti otomatis.
5. Tekan **Rekap sesi** di akhir untuk membagikan hasilnya.

## Menjalankan

Tidak perlu build. Buka `index.html` di browser, atau taruh ketiga file di hosting statis seperti GitHub Pages atau Netlify.

```
index.html             struktur halaman
style.css              tampilan, semua warna dan font ada di token :root
script.js              logika rotasi, skor, timer, arena, rekap, penyimpanan
manifest.webmanifest   data aplikasi untuk Add to Home Screen
sw.js                  service worker untuk mode offline
icon-192.png, icon-512.png, apple-touch-icon.png   ikon aplikasi
```

## Pasang di layar utama (PWA)

Aplikasi bisa dipasang seperti aplikasi biasa: terbuka layar penuh tanpa bar browser dan tetap jalan tanpa internet.

1. Taruh semua file di hosting HTTPS (GitHub Pages atau Netlify). Mode offline tidak aktif kalau file dibuka langsung dari penyimpanan perangkat.
2. Buka alamatnya di Safari (iPhone) atau Chrome (Android).
3. iPhone: Bagikan, lalu **Tambah ke Layar Utama**. Android: menu titik tiga, lalu **Instal aplikasi**.
4. Setelah dibuka sekali dengan internet, aplikasi tersimpan di perangkat. Layar tetap menyala selama timer berjalan.

Setiap kali mengubah file aplikasi, naikkan `VERSION` di `sw.js` (misalnya `domino-v2`) supaya perangkat mengambil versi terbaru.

## Data

Semua data disimpan di `localStorage` browser perangkat ini. Data tidak ikut berpindah ke perangkat lain, jadi ekspor JSON dulu kalau ingin memindahkan atau mencadangkan sesi. Menghapus data browser atau memakai **Reset semua data** akan menghapus sesi.

## Tampilan

Desain bertema domino: latar meja felt hijau (60%), panel dan kartu berupa ubin gading atau hitam dengan garis pembagi dan pin kuningan (30%), dan merah pip untuk aksi utama (10%). Font Schibsted Grotesk dimuat dari Google Fonts. Untuk mengganti warna, ubah variabel di blok `:root` dan `:root[data-theme="dark"]` pada bagian paling bawah `style.css`. Teks di atas panel memakai `--text`, teks di atas latar halaman memakai `--on-bg`.
