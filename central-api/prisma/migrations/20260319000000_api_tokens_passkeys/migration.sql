-- AlterTable: add mfaCompleted to TenantAuth
ALTER TABLE "TenantAuth" ADD COLUMN "mfaCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: TenantApiToken
CREATE TABLE "TenantApiToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TenantPasskey
CREATE TABLE "TenantPasskey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "credentialId" BYTEA NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[],
    "friendlyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantApiToken_tokenHash_idx" ON "TenantApiToken"("tokenHash");
CREATE INDEX "TenantApiToken_tenantId_idx" ON "TenantApiToken"("tenantId");
CREATE INDEX "TenantPasskey_tenantId_idx" ON "TenantPasskey"("tenantId");
CREATE INDEX "TenantPasskey_credentialId_idx" ON "TenantPasskey"("credentialId");

-- AddForeignKey
ALTER TABLE "TenantApiToken" ADD CONSTRAINT "TenantApiToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantPasskey" ADD CONSTRAINT "TenantPasskey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce one active token per tenant (NULL-aware unique constraint)
CREATE UNIQUE INDEX "unique_active_token" ON "TenantApiToken" ("tenantId") WHERE "revokedAt" IS NULL;
