import { describe, it, expect } from "vitest";
import {
  generateCode,
  hashCode,
  hashPin,
  verifyCode,
  verifyPin,
  checkExpiration,
  hashIp,
} from "../share-service.js";

describe("share-service", () => {
  describe("generateCode", () => {
    it("returns a 22-char base64url string", () => {
      const code = generateCode();
      expect(code).toHaveLength(22);
      // base64url alphabet: A-Z, a-z, 0-9, -, _
      expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });

    it("generates unique codes", () => {
      const codes = new Set(Array.from({ length: 100 }, () => generateCode()));
      expect(codes.size).toBe(100);
    });
  });

  describe("hashCode", () => {
    it("returns a 64-char hex SHA-256 digest", () => {
      const hash = hashCode("test-code");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces deterministic output", () => {
      expect(hashCode("abc")).toBe(hashCode("abc"));
    });

    it("produces different hashes for different inputs", () => {
      expect(hashCode("a")).not.toBe(hashCode("b"));
    });
  });

  describe("hashPin", () => {
    it("returns a 64-char hex SHA-256 digest", () => {
      const hash = hashPin("1234");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("differs from hashCode for same input", () => {
      expect(hashPin("test")).not.toBe(hashCode("test"));
    });
  });

  describe("verifyCode", () => {
    it("returns true for matching code/hash pair", () => {
      const code = generateCode();
      const hash = hashCode(code);
      expect(verifyCode(code, hash)).toBe(true);
    });

    it("returns false for mismatched code", () => {
      const hash = hashCode("correct-code");
      expect(verifyCode("wrong-code", hash)).toBe(false);
    });
  });

  describe("verifyPin", () => {
    it("returns true for matching pin/hash pair", () => {
      const pin = "5678";
      const hash = hashPin(pin);
      expect(verifyPin(pin, hash)).toBe(true);
    });

    it("returns false for mismatched pin", () => {
      const hash = hashPin("1234");
      expect(verifyPin("0000", hash)).toBe(false);
    });
  });

  describe("checkExpiration", () => {
    it("returns true when expiresAt is in the past", () => {
      const past = new Date(Date.now() - 60_000);
      expect(checkExpiration({ expiresAt: past })).toBe(true);
    });

    it("returns false when expiresAt is in the future", () => {
      const future = new Date(Date.now() + 60_000);
      expect(checkExpiration({ expiresAt: future })).toBe(false);
    });
  });

  describe("hashIp", () => {
    it("returns a 64-char hex digest", () => {
      const hash = hashIp("192.168.1.1");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
      expect(hashIp("10.0.0.1")).toBe(hashIp("10.0.0.1"));
    });
  });
});
