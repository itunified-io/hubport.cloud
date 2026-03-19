import { PrismaClient } from "@prisma/client";
import { encryptionExtension } from "./prisma-encryption.js";

const basePrisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["warn", "error"],
});

// Transparent field-level encryption for personal data (Publisher model)
const prisma = basePrisma.$extends(encryptionExtension);

export default prisma;
