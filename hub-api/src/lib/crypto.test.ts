import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto.js";

const TEST_KEY = randomBytes(32);

describe("crypto", () => {
  it("encrypt then decrypt returns the original plaintext", () => {
    const plaintext = "Jane Doe";
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);

    assert.equal(decrypted, plaintext);
  });

  it("different IVs produce different ciphertext for the same input", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext, TEST_KEY);
    const b = encrypt(plaintext, TEST_KEY);

    assert.notEqual(a, b, "two encryptions of the same plaintext must differ");

    // Both must still decrypt to the original
    assert.equal(decrypt(a, TEST_KEY), plaintext);
    assert.equal(decrypt(b, TEST_KEY), plaintext);
  });

  it("tampered ciphertext fails decryption", () => {
    const encrypted = encrypt("secret", TEST_KEY);
    const [iv, ciphertext, authTag] = encrypted.split(":");

    // Flip a character in the ciphertext
    const buf = Buffer.from(ciphertext, "base64");
    buf[0] ^= 0xff;
    const tampered = [iv, buf.toString("base64"), authTag].join(":");

    assert.throws(() => decrypt(tampered, TEST_KEY));
  });

  it("encrypts and decrypts an empty string", () => {
    const plaintext = "";
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);

    assert.equal(decrypted, plaintext);
  });

  it("handles unicode content correctly", () => {
    const plaintext = "Muller-Schmitt";
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);

    assert.equal(decrypted, plaintext);
  });

  it("rejects malformed encrypted strings", () => {
    assert.throws(() => decrypt("not-valid", TEST_KEY), /Invalid encrypted format/);
    assert.throws(() => decrypt("a:b", TEST_KEY), /Invalid encrypted format/);
  });

  it("rejects decryption with a wrong key", () => {
    const encrypted = encrypt("secret", TEST_KEY);
    const wrongKey = randomBytes(32);

    assert.throws(() => decrypt(encrypted, wrongKey));
  });
});
