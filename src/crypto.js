const KDF_ITERATIONS = 250000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypts a state object into a self-describing envelope. */
export async function encryptState(state, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    encrypted: true,
    format: 'budget-planner-encrypted-v1',
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
}

export function isEncryptedEnvelope(parsed) {
  return !!parsed && parsed.encrypted === true && typeof parsed.data === 'string';
}

/** Decrypts an envelope produced by encryptState. Throws on a wrong passphrase. */
export async function decryptState(envelope, passphrase) {
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, envelope.iterations || KDF_ITERATIONS);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(envelope.data));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
}
