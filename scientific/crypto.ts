import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const textEncoder = new TextEncoder();

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(textEncoder.encode(value)));
}

export function secureRandomHex(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 65_536) {
    throw new RangeError('byteLength must be an integer between 1 and 65536.');
  }

  const cryptoProvider = globalThis.crypto;
  if (!cryptoProvider?.getRandomValues) {
    throw new Error('A secure random number generator is unavailable.');
  }

  return bytesToHex(cryptoProvider.getRandomValues(new Uint8Array(byteLength)));
}