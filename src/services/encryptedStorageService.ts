/**
 * Encrypted Client-Side Storage Service
 * 
 * Provides an AES-GCM 256-bit encrypted client-side storage strategy
 * for Binance API credentials (API Key & Secret Key) across browser
 * refreshes and page reloads.
 * 
 * Uses dual-layer client persistence:
 * 1. Encrypted payload in window.localStorage ('apex_encrypted_credentials_vault')
 * 2. Mirror encrypted storage in window.indexedDB ('apex_secure_vault_db')
 */

export interface EncryptedCredentialsPayload {
  apiKey: string;
  apiSecret: string;
  isTestnet: boolean;
  walletName?: string;
  savedAt: number;
}

interface EncryptedBundle {
  v: number; // schema version
  s: string; // base64 salt
  i: string; // base64 iv
  c: string; // base64 ciphertext
}

const LOCAL_STORAGE_KEY = 'apex_encrypted_credentials_vault';
const IDB_NAME = 'apex_secure_vault_db';
const IDB_VERSION = 1;
const IDB_STORE = 'credentials_vault';
const IDB_RECORD_KEY = 'binance_active_credentials';

// Helpers for Uint8Array <-> Base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// IndexedDB Helper
function openVaultIndexedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[EncryptedStorage] Failed to open IndexedDB:', request.error);
        resolve(null);
      };
    } catch (e) {
      console.warn('[EncryptedStorage] IndexedDB initialization error:', e);
      resolve(null);
    }
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openVaultIndexedDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: string): Promise<boolean> {
  const db = await openVaultIndexedDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openVaultIndexedDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export class EncryptedStorageService {
  private static passphraseSeed = 'APEX_TRADING_BOT_VAULT_KEY_SEED_V2';

  /**
   * Derives an AES-GCM 256-bit encryption key using PBKDF2 from a salt
   */
  private static async deriveKey(salt: Uint8Array): Promise<CryptoKey | null> {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      return null;
    }
    try {
      const enc = new TextEncoder();
      const originKey = window.location.origin || 'apex-local-app';
      const masterKeyMaterial = enc.encode(`${this.passphraseSeed}::${originKey}`);
      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        masterKeyMaterial,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      return await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations: 100000,
          hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      console.warn('[EncryptedStorage] Key derivation failed:', err);
      return null;
    }
  }

  /**
   * Encrypts plaintext string using AES-GCM
   */
  public static async encrypt(plainText: string): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(salt);

    if (!key) {
      // Obfuscated fallback for non-WebCrypto environments
      return JSON.stringify({
        v: 0,
        s: '',
        i: '',
        c: btoa(encodeURIComponent(plainText)),
      });
    }

    const enc = new TextEncoder();
    const encoded = enc.encode(plainText);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    const bundle: EncryptedBundle = {
      v: 1,
      s: uint8ArrayToBase64(salt),
      i: uint8ArrayToBase64(iv),
      c: uint8ArrayToBase64(new Uint8Array(ciphertextBuffer)),
    };

    return JSON.stringify(bundle);
  }

  /**
   * Decrypts ciphertext string using AES-GCM
   */
  public static async decrypt(encryptedPayload: string): Promise<string | null> {
    try {
      const bundle: EncryptedBundle = JSON.parse(encryptedPayload);
      if (bundle.v === 0) {
        return decodeURIComponent(atob(bundle.c));
      }

      if (!bundle.s || !bundle.i || !bundle.c) {
        return null;
      }

      const salt = base64ToUint8Array(bundle.s);
      const iv = base64ToUint8Array(bundle.i);
      const ciphertext = base64ToUint8Array(bundle.c);

      const key = await this.deriveKey(salt);
      if (!key) return null;

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as any,
        },
        key,
        ciphertext as any
      );

      const dec = new TextDecoder();
      return dec.decode(decryptedBuffer);
    } catch (err) {
      console.warn('[EncryptedStorage] Decryption failed:', err);
      return null;
    }
  }

  /**
   * Encrypts and securely stores Binance credentials in both localStorage and IndexedDB
   */
  public static async saveCredentials(creds: {
    apiKey: string;
    apiSecret: string;
    isTestnet: boolean;
    walletName?: string;
  }): Promise<boolean> {
    if (!creds.apiKey || !creds.apiSecret) {
      return false;
    }

    try {
      const payload: EncryptedCredentialsPayload = {
        apiKey: creds.apiKey.trim(),
        apiSecret: creds.apiSecret.trim(),
        isTestnet: creds.isTestnet,
        walletName: creds.walletName,
        savedAt: Date.now(),
      };

      const serialized = JSON.stringify(payload);
      const encrypted = await this.encrypt(serialized);

      // 1. Save to LocalStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(LOCAL_STORAGE_KEY, encrypted);
        } catch (e) {
          console.warn('[EncryptedStorage] LocalStorage write failed:', e);
        }
      }

      // 2. Mirror into IndexedDB for durability across tab/iframe restarts
      await idbSet(IDB_RECORD_KEY, encrypted);

      return true;
    } catch (err) {
      console.error('[EncryptedStorage] Failed to save encrypted credentials:', err);
      return false;
    }
  }

  /**
   * Loads and decrypts credentials from localStorage or IndexedDB fallback
   */
  public static async loadCredentials(): Promise<EncryptedCredentialsPayload | null> {
    try {
      let rawEncrypted: string | null = null;

      // 1. Try LocalStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          rawEncrypted = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        } catch {
          rawEncrypted = null;
        }
      }

      // 2. Fallback to IndexedDB if localStorage was empty or cleared
      if (!rawEncrypted) {
        rawEncrypted = await idbGet(IDB_RECORD_KEY);
        // If recovered from IndexedDB, re-sync to LocalStorage
        if (rawEncrypted && typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(LOCAL_STORAGE_KEY, rawEncrypted);
          } catch {
            // ignore
          }
        }
      }

      if (!rawEncrypted) {
        return null;
      }

      const decryptedJson = await this.decrypt(rawEncrypted);
      if (!decryptedJson) {
        return null;
      }

      const parsed: EncryptedCredentialsPayload = JSON.parse(decryptedJson);
      if (parsed.apiKey && parsed.apiSecret) {
        return parsed;
      }
      return null;
    } catch (err) {
      console.warn('[EncryptedStorage] Failed to load encrypted credentials:', err);
      return null;
    }
  }

  /**
   * Clears encrypted credentials from both LocalStorage and IndexedDB
   */
  public static async clearCredentials(): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    await idbDelete(IDB_RECORD_KEY);
  }
}
