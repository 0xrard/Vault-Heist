import {
  initSDK,
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
} from "@zama-fhe/relayer-sdk/bundle";
import { BrowserProvider, type Signer } from "ethers";

let fheInstance: FhevmInstance | null = null;

// 1. Inisialisasi instance FHEVM di jaringan Sepolia
export async function getFheInstance(): Promise<FhevmInstance> {
  if (fheInstance) return fheInstance;

  await initSDK(); // Memuat modul WASM TFHE
  fheInstance = await createInstance({
    ...SepoliaConfig,
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

// 3. Dekripsi Pribadi (User Decryption) untuk fitur Scout via EIP-712
export async function decryptScoutResult(
  handle: string,
  contractAddress: string,
  signer: Signer
): Promise<number> {
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

  return Number(result[handle as `0x${string}`]);
}

// 4. Dekripsi Publik untuk status alarm & papan skor di akhir ronde
export async function decryptPublicValues(handles: string[]) {
  const instance = await getFheInstance();
  const result = await instance.publicDecrypt(handles);
  return result.clearValues as Record<string, unknown>;
}

// Helper koneksi MetaMask + cek Sepolia (Chain ID 11155111)
export async function connectSepoliaWallet() {
  if (!(window as any).ethereum) {
    throw new Error("MetaMask tidak ditemukan");
  }
  const provider = new BrowserProvider((window as any).ethereum);
  await provider.send("eth_requestAccounts", []);

  const network = await provider.getNetwork();
  if (network.chainId !== 11155111n) {
    await (window as any).ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
  }

  return await provider.getSigner();
}
