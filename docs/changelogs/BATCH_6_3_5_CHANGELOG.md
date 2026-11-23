# Batch 6.3.5 — VaultScouted Filter Form Correction (Live QA Blocker Fix)

Patch satu baris dari lanjutan QA live Nino (23 Nov 2026): setelah
Batch 6.3.4 terpasang dan terverifikasi melayani build baru, status Scout
tetap `unknown` di semua kartu, padahal rantai terbukti sehat — request
RPC berstatus 200, scan jangkar dan scan commit selesai konklusif dari
mesin pengembangan, dan cache jangkar match #12 di browser Nino berisi
blok yang benar (12.193.734).

## Akar masalah (direproduksi persis, 23 Nov 2026)

Menjalankan pola `findScoutOnchain` apa adanya di node (ethers + ABI
asli + RPC live) melempar error berikut pada saat filter DIBANGUN,
sebelum query apa pun terkirim:

```
TypeError: cannot filter non-indexed parameters; must be null
(argument="contract.round", value="0x9d58...3dF7")
```

Argumen filter Ethers v6 bersifat POSISIONAL atas semua parameter event.
Tanda tangan asli di kontrak (VaultHeist.sol:59 dan ABI):

```
VaultScouted(uint256 indexed matchId, uint8 round, address indexed player, uint8 vaultIdx, bool isAlarm)
```

Bentuk dua argumen `(matchId, walletAddress)` yang diperkenalkan
Batch 6 menaruh alamat wallet di slot `round` (parameter kedua,
non-indexed), sehingga Ethers melempar, `catch` di `findScoutOnchain`
mengembalikan null, dan status Scout jatuh ke `unknown` pada setiap
pemeriksaan — permanen, di semua browser dan semua match, sejak
Batch 6. Komentar Batch 6 yang menyatakan bentuk dua argumen sebagai
"bentuk yang benar" keliru membaca aturan filter Ethers.

Verifikasi commit tidak pernah terkena bug ini: `findRoundCommits`
memakai filter satu argumen `AllocationCommitted(matchId)` dan menyaring
ronde/pemain dari args log. Filter `MatchCreated(matchId)` juga aman.
Ketiganya adalah satu-satunya pemakaian `filters.*` di seluruh frontend
(diaudit).

## File yang berubah

| File | Perubahan |
| --- | --- |
| frontend/src/lib/scoutStorage.ts | Filter VaultScouted `(matchId, walletAddress)` → `(matchId, null, walletAddress)`; komentar Batch 6 yang keliru diganti dengan aturan posisional yang benar |
| BATCH_6_3_5_CHANGELOG.md | Baru (dokumen ini) |

## Verifikasi

- Bentuk lama direproduksi melempar `cannot filter non-indexed
  parameters` secara lokal (tanpa RPC) — persis jalur kegagalan aplikasi.
- Bentuk baru: konstruksi ketiga filter aplikasi lolos tanpa lemparan;
  topics untuk VaultScouted terarah ke matchId + player.
- Kasus negatif live: match #12 + wallet pembuat room — scan dengan
  filter baru selesai KONKLUSIF, 0 event (benar: belum ada Scout),
  sehingga status yang sah adalah verified-unused dan cap budget 10
  terbuka.
- Kasus positif live tidak tersedia untuk diperagakan: tidak ada event
  VaultScouted apa pun di 10.000 blok terakhir yang dilayani RPC publik
  ini (satu-satunya permainan terkini adalah match QA yang Scout-nya
  memang terblokir bug ini), dan riwayat match #4 (Scout terakhir yang
  berhasil, era sebelum Batch 6) sudah di luar jendela retensi node
  gratis — query ke rentang itu ditolak dengan error 4444
  "pruned history unavailable". Jalur positif memakai penyaringan args
  yang sama seperti sebelum Batch 6, saat Scout bekerja end-to-end.
- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0.
- Kontrak: `npx hardhat test` run segar, 13 passing, 0 failing.
- File terkunci identik (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Catatan

- Dua bug bertumpuk menutupi satu sama lain selama QA ini: ukuran chunk
  45.000 (Batch 6.3.4) memblokir scan jangkar, dan bentuk filter
  VaultScouted (batch ini) memblokir verifikasi Scout bahkan ketika scan
  berjalan. Keduanya kini tertutup.
- Observasi retensi RPC: node publik gratis hanya melayani riwayat
  sekitar 10–20 ribu blok terakhir; verifikasi match lama di luar
  jendela itu berakhir tidak konklusif (fail-closed, sesuai desain) —
  match segar tidak terpengaruh.
