import { PrismaClient } from "@prisma/client";
import { encryptionExtension } from "./prisma-encryption.js";
import { syncVersionExtension } from "../middleware/version-middleware.js";

const basePrisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["warn", "error"],
});

// Transparent field-level encryption for personal data (Publisher model)
// Auto-increment syncVersion on every update to syncable models (PWA offline sync)
const prisma = basePrisma
  .$extends(encryptionExtension)
  .$extends(syncVersionExtension);

export default prisma;
