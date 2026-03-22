import { PrismaClient } from '@prisma/client';
import { encryptionExtension } from './prisma-encryption.js';

const basePrisma = new PrismaClient();
export const prisma = basePrisma.$extends(encryptionExtension);
