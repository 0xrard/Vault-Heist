# Batch 6.3.3 — Empty-String Record Correction (Final Hardening Patch)

Satu koreksi satu baris dari audit Batch 6.3.2 oleh Nino. Tidak ada perubahan
arsitektur, state machine, gameplay, kontrak, atau ABI. Ini patch terakhir
rangkaian hardening recovery 6.x; setelah ini batas perubahan teknis
ditetapkan dan pekerjaan beralih ke final campaign QA.

## File yang berubah

| File | Perubahan |
| --- | --- |
| frontend/src/lib/pendingTxStorage.ts | Baris 141: `if (!raw)` menjadi `if (raw === null)` di `loadPendingTxResult()` |
| BATCH_6_3_3_CHANGELOG.md | Baru (dokumen ini) |

GameArena.tsx tidak berubah pada batch ini.

## Alasan

`localStorage.getItem()` memiliki dua hasil yang berbeda maknanya:

- `null`: key memang tidak ada, klasifikasi `absent` benar.
- `""`: key ADA tetapi nilainya string kosong, yaitu record yang ada namun
  tidak valid.

Kondisi lama `if (!raw)` menyamakan keduanya sebagai `absent`, sehingga
sebuah key transaksi yang isinya kosong (kerusakan atau perubahan data) lolos
dari perlindungan fail-closed Batch 6.3.2: hidrasi dianggap berhasil, event
scan boleh berjalan, dan kontrol berpotensi terbuka selagi transaksi asli
masih pending.

Dengan `if (raw === null)`:

- `null` → `absent` (tidak berubah).
- `""` → lanjut ke `JSON.parse("")`, melempar SyntaxError → `invalid` →
  hidrasi fail-closed + peringatan recovery (jalur 6.3.2 yang sudah ada).
- JSON rusak lain → `invalid` (tidak berubah).
- JSON valid, identitas tidak cocok → `invalid` (tidak berubah).

## Risiko regresi

Minimal. Satu-satunya perilaku yang berubah adalah klasifikasi string
kosong: dari `absent` menjadi `invalid`. Tidak ada jalur penulisan yang
menyimpan string kosong (`savePendingTx` selalu menulis JSON record
lengkap), jadi nilai kosong hanya dapat muncul dari kerusakan atau campur
tangan eksternal, persis kasus yang harus fail-closed.

## Acceptance

| # | Skenario | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Key tidak ada (`null`) | `absent`, verifikasi onchain lanjut seperti sebelumnya | Kondisi `raw === null`, baris 141 |
| 2 | Key ada, nilai string kosong (`""`) | `invalid`, fail-closed + peringatan recovery | `""` tidak lolos kondisi null, masuk `JSON.parse`; primitif penentunya dieksekusi langsung: `JSON.parse("")` melempar SyntaxError (diverifikasi dengan node pada sesi patch ini), ditangkap jalur parse 6.3.2 yang mengembalikan `invalid` |
| 3 | Key ada, JSON rusak | `invalid` (tidak berubah) | Jalur parse 6.3.2 |
| 4 | Key ada, JSON valid, identitas tidak cocok | `invalid` (tidak berubah) | Jalur validasi 6.3.2 |
| 5 | Key ada, record valid | `found` (tidak berubah) | Jalur validasi 6.3.2 |

Simulasi live (transaksi pending + refresh, record korup yang disuntikkan,
storage failure) tetap berada di daftar QA manual Nino dan tidak diklaim
terverifikasi di sini.

## Verifikasi (dijalankan pada sesi patch ini)

- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0 (hanya peringatan ukuran chunk
  FHE WASM yang sudah ada sebelumnya).
- Kontrak: `npx hardhat test` run segar, 13 passing, 0 failing.
- Primitif regresi: `JSON.parse("")` terkonfirmasi melempar SyntaxError.
- File terkunci identik sebelum dan sesudah (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`
