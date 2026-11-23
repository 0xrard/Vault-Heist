# Batch 6.3.4 — Scan Chunk Size Correction (Live QA Blocker Fix)

Patch satu konstanta dari temuan QA live Nino (23 Nov 2026): pada uji PvP
dua wallet, seluruh kontrol arena terkunci permanen dan tombol
RETRY STATUS CHECK terasa tidak berfungsi. Akar masalahnya bukan pada
logika fail-closed (yang bekerja persis seperti desain Batch 6–6.3.3),
melainkan pada ukuran potongan scan event yang ditolak oleh RPC publik.

## Bukti akar masalah (diukur langsung, 23 Nov 2026)

Semua pembacaan onchain berjalan lewat satu RPC publik gratis
(`ethereum-sepolia-rpc.publicnode.com`, lihat `src/lib/contracts.ts`).
Scan event aplikasi memakai chunk 45.000 blok. Pengujian `eth_getLogs`
langsung ke endpoint tersebut dari mesin pengembangan:

| Rentang per query | Hasil |
| --- | --- |
| 45.000 blok | DITOLAK: error 4444 "pruned history unavailable" |
| 10.000 blok | Dilayani, log kembali normal |
| 1.000 blok | Dilayani |
| 100 blok | Dilayani |

Setiap chunk 45.000 gagal seketika, sehingga scan tidak pernah konklusif,
status jatuh ke `unknown`, dan sesuai desain fail-closed seluruh kontrol
tetap terkunci. Retry mengulang scan yang sama dan gagal dengan cara yang
sama. Kontrak terdeploy 20 Nov 2026; seluruh riwayatnya sampai 23 Nov
hanya sekitar 16 ribu blok, jadi jangkauan bukan masalah — ukuran chunk
per query adalah satu-satunya penolakan.

## File yang berubah

| File | Perubahan |
| --- | --- |
| frontend/src/lib/contracts.ts | `LOG_CHUNK_BLOCKS` 45000 → 10000 (baris 104); komentar jangkauan `MAX_ANCHOR_CHUNKS` diperbarui (~480 ribu blok) |
| BATCH_6_3_4_CHANGELOG.md | Baru (dokumen ini) |

Tidak ada perubahan lain. Arsitektur scan (jangkar MatchCreated, scan
chunk berurutan, hasil null = tidak konklusif), gerbang hash Batch 6.2,
hidrasi fail-closed 6.3.1–6.3.3, dan semua aturan fail-closed tidak berubah.
`MAX_ANCHOR_CHUNKS` tetap 48: pada chunk 10.000 jangkauan pencarian jangkar
menjadi ~480 ribu blok, masih sekitar 30 kali seluruh riwayat kontrak.

## Verifikasi

- **Smoke test pola scan aplikasi melawan RPC live** (skrip node sekali
  pakai memakai ethers + ABI asli + pola chunk yang sama persis, untuk
  match #9 yang sedang dimainkan Nino): tip 12.193.693; jangkar
  MatchCreated(9) ditemukan di chunk pertama pada blok 12.193.665;
  scan maju AllocationCommitted(9) selesai konklusif dengan 0 log (benar:
  belum ada pemain yang commit pada ronde itu); total 1,7 detik.
  Pola yang sama pada chunk 45.000 gagal di query pertama.
- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0 (hanya peringatan ukuran chunk
  FHE WASM yang sudah ada sebelumnya).
- Kontrak: `npx hardhat test` run segar, 13 passing, 0 failing.
- File terkunci identik (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Catatan

- Perbaikan ini hanya terbukti bila build hasil patch yang dijalankan
  pemain; build lama (chunk 45.000) tetap tidak dapat menyelesaikan
  verifikasi di endpoint ini.
- Uji live lanjutan (PvP selesai 3 ronde, pending + refresh, dan daftar
  QA lainnya) tetap berada di tangan Nino setelah build ini terpasang.
