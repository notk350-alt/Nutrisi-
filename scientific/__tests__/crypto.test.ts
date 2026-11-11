import { describe, expect, it } from 'vitest';
import { secureRandomHex, sha256Hex } from '../crypto';

describe('shared scientific cryptography', () => {
  it('matches standard SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('generates fixed-length hexadecimal values with secure randomness', () => {
    expect(secureRandomHex(16)).toMatch(/^[a-f0-9]{32}$/);
  });

  it('rejects invalid random byte lengths', () => {
    expect(() => secureRandomHex(0)).toThrow(RangeError);
    expect(() => secureRandomHex(1.5)).toThrow(RangeError);
  });
});