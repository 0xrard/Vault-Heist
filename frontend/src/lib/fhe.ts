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

  const sdk = await import("@zama-fhe/relayer-sdk/web");
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
  const result = await instance.publicDecrypt(handles);
  return result.clearValues as Record<string, unknown>;
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
    throw new Error("MetaMask tidak ditemukan. Pasang ekstensi MetaMask lalu muat ulang halaman ini.");
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

// Ubah error mentah (wallet/relayer/kontrak) menjadi pesan yang bersih untuk UI
export function friendlyError(err: any): string {
  const code = err?.code ?? err?.info?.error?.code;
  const msg = String(err?.shortMessage ?? err?.reason ?? err?.message ?? err ?? "");

  if (code === "ACTION_REJECTED" || code === 4001 || /user rejected|user denied/i.test(msg)) {
    return "Ditolak di wallet. Transaksi/tanda tangan dibatalkan — tidak ada yang terkirim.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Saldo Sepolia ETH tidak cukup untuk gas. Isi dulu dari faucet Sepolia, lalu coba lagi.";
  }
  if (/missing revert data|CALL_EXCEPTION/i.test(msg)) {
    return "Node RPC jaringan Sepolia di wallet-mu tidak menemukan kontrak ini. Periksa URL RPC Sepolia di MetaMask (Settings → Networks → Sepolia) atau coba lagi sebentar.";
  }
  if (/MetaMask tidak ditemukan/i.test(msg)) {
    return msg;
  }
  if (/relayer|fetch|network|timeout|timed out/i.test(msg)) {
    return "Gangguan jaringan/relayer Zama. Tunggu beberapa detik lalu coba lagi.";
  }
  if (/Match tidak aktif/i.test(msg)) return "Match ini sudah selesai atau belum aktif.";
  if (/Sudah scout atau commit/i.test(msg)) return "Kamu sudah memakai Scout (atau sudah commit) di ronde ini.";
  if (/Bukan peserta match/i.test(msg)) return "Wallet ini bukan peserta match tersebut.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg || "Terjadi kesalahan tak dikenal.";
}
