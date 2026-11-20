import { BrowserProvider, type Signer } from "ethers";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

export const SEPOLIA_CHAIN_ID = 11155111n;
export const ZERO_HANDLE = "0x" + "0".repeat(64);

let fheInstance: FhevmInstance | null = null;

// ---------------------------------------------------------------------------
// 1. Inisialisasi instance FHEVM di jaringan Sepolia
// PENTING: SDK dimuat secara lazy (dynamic import dari jalur /web).
// Impor statis dari paket ini menyebabkan circular-dependency crash saat
// evaluasi modul di browser ("Cannot read properties of undefined (reading
// 'initSDK')") yang membuat seluruh aplikasi gagal render (halaman kosong).
// ---------------------------------------------------------------------------
export async function getFheInstance(): Promise<FhevmInstance> {
  if (fheInstance) return fheInstance;

  let sdk: typeof import("@zama-fhe/relayer-sdk/web");
  try {
    sdk = await import("@zama-fhe/relayer-sdk/web");
  } catch {
    // Chunk SDK bisa gagal dimuat sesaat (jaringan) atau karena tab memegang
    // build lama — beri satu kesempatan lagi sebelum menyerah.
    await new Promise((r) => setTimeout(r, 1500));
    sdk = await import("@zama-fhe/relayer-sdk/web");
  }
  await sdk.initSDK(); // Memuat modul WASM TFHE
  fheInstance = await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: (window as any).ethereum,
  });

  return fheInstance;
}

// 2. Enkripsi 3 alokasi kru (Vault A, B, C) dalam 1 input proof
export async function encryptBids(
  contractAddress: string,
  userAddress: string,
  bids: [number, number, number]
) {
  const instance = await getFheInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);

  input.add8(bids[0]);
  input.add8(bids[1]);
  input.add8(bids[2]);

  const encrypted = await input.encrypt();
  return {
    handles: [
      encrypted.handles[0],
      encrypted.handles[1],
      encrypted.handles[2],
    ] as [Uint8Array, Uint8Array, Uint8Array],
    inputProof: encrypted.inputProof,
  };
}

// 3. Dekripsi Pribadi (User Decryption) via EIP-712 — dipakai untuk Scout
//    (handle euint8 di VaultHeist) maupun saldo cLOOT (handle euint64 di
//    HeistLootToken). Mengembalikan nilai mentah sebagai bigint.
export async function userDecryptHandle(
  handle: string,
  contractAddress: string,
  signer: Signer
): Promise<bigint> {
  const instance = await getFheInstance();
  const userAddress = await signer.getAddress();

  // Buat keypair sementara di browser agar hasil dekripsi hanya bisa dibaca user ini
  const keypair = instance.generateKeypair();
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays
  );

  // User menandatangani pesan EIP-712 di MetaMask (gratis, tanpa gas)
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays
  );

  return BigInt(result[handle as `0x${string}`] as any);
}

// Alias kompatibilitas: versi Number dari userDecryptHandle
export async function decryptScoutResult(
  handle: string,
  contractAddress: string,
  signer: Signer
): Promise<number> {
  return Number(await userDecryptHandle(handle, contractAddress, signer));
}

// 4. Dekripsi Publik untuk status alarm & papan skor di akhir ronde
export async function publicDecryptHandles(handles: string[]) {
  const instance = await getFheInstance();
  // Relayer testnet fluktuatif: job dekripsi publik sering gagal di langkah
  // polling, dan handle yang baru dibuat publicly-decryptable butuh waktu
  // terindeks relayer ("not allowed for public decryption" sesaat). Dekripsi
  // publik tidak butuh tanda tangan, jadi aman di-retry otomatis di sini —
  // semua pemanggil (resolusi ronde, resume, ringkasan) ikut diuntungkan.
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await instance.publicDecrypt(handles);
      return result.clearValues as Record<string, unknown>;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

// Alias kompatibilitas
export const decryptPublicValues = publicDecryptHandles;

// Handle kosong (saldo token yang belum pernah menerima mint adalah zero hash)
export function isZeroHandle(handle: string | null | undefined): boolean {
  if (!handle) return true;
  return /^0x0*$/.test(handle);
}

// ---------------------------------------------------------------------------
// Koneksi MetaMask + jaringan Sepolia
// ---------------------------------------------------------------------------
export async function connectSepoliaWallet(): Promise<Signer> {
  if (!(window as any).ethereum) {
    throw new Error("MetaMask not found. Install the MetaMask extension, then reload this page.");
  }
  const provider = new BrowserProvider((window as any).ethereum);
  await provider.send("eth_requestAccounts", []);
  await ensureSepolia();
  return await provider.getSigner();
}

export async function ensureSepolia(): Promise<void> {
  if (!(window as any).ethereum) return;
  const provider = new BrowserProvider((window as any).ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (err: any) {
      // Chain belum dikenal MetaMask -> tambahkan Sepolia secara eksplisit
      if (err?.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xaa36a7",
              chainName: "Ethereum Sepolia",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }
}

export async function currentChainId(): Promise<bigint | null> {
  if (!(window as any).ethereum) return null;
  const provider = new BrowserProvider((window as any).ethereum);
  return (await provider.getNetwork()).chainId;
}

// Ubah error mentah (wallet/relayer/kontrak) menjadi pesan yang bersih untuk UI.
// Pesan ramah selalu disertai detail asli (dipangkas) agar penyebab sebenarnya
// tetap terlihat di banner tanpa perlu membuka console browser.
export function friendlyError(err: any): string {
  const code = err?.code ?? err?.info?.error?.code;
  const msg = String(err?.shortMessage ?? err?.reason ?? err?.message ?? err ?? "");
  const detail = msg ? ` (detail: ${msg.length > 140 ? msg.slice(0, 140) + "…" : msg})` : "";

  if (code === "ACTION_REJECTED" || code === 4001 || /user rejected|user denied/i.test(msg)) {
    return "Rejected in your wallet. The transaction/signature was cancelled — nothing was sent.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Not enough Sepolia ETH for gas. Top up from a Sepolia faucet, then try again." + detail;
  }
  if (/missing revert data|CALL_EXCEPTION/i.test(msg)) {
    return "Your wallet's Sepolia RPC node could not find this contract. Check the Sepolia RPC URL in MetaMask (Settings → Networks → Sepolia), or try again in a moment." + detail;
  }
  if (/MetaMask not found/i.test(msg)) {
    return msg;
  }
  if (/dynamically imported module|preload/i.test(msg)) {
    return "The app was updated in the background and this tab is stale. Hard-refresh the page (Ctrl+Shift+R), then try again." + detail;
  }
  if (/relayer|fetch|network|timeout|timed out/i.test(msg)) {
    return "Zama relayer / network hiccup. Wait a few seconds and try again." + detail;
  }
  if (/Match tidak aktif/i.test(msg)) return "This match is already finished or not active yet." + detail;
  if (/Sudah scout atau commit/i.test(msg)) return "You have already used your Scout (or already committed) this round." + detail;
  if (/Bukan peserta match/i.test(msg)) return "This wallet is not a participant in that match." + detail;
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg || "An unknown error occurred.";
}
