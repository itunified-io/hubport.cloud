import { PrismaClient } from "@prisma/client";
import { encryptionMiddleware } from "./prisma-encryption.js";

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["warn", "error"],
});

// Transparent field-level encryption for personal data (Publisher model)
prisma.$use(encryptionMiddleware());

export default prisma;
