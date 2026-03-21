# Vault Production Mode + Keycloak Passkey + Chat Widget — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vault dev mode with production AppRole auth, move passkey/TOTP to Keycloak-only storage, and build a LinkedIn-style chat widget with matrix-js-sdk.

**Architecture:** Three independent phases shipped sequentially. Phase 1 (Vault) changes the installer + hub-api vault client. Phase 2 (Keycloak) modifies the installer auth flow + hub-api security routes + drops WebAuthnCredential table. Phase 3 (Chat) is the largest — new React chat widget, matrix-js-sdk integration, pre-seeded Spaces, RBAC, campaigns, Jitsi calls, and profile pictures.

**Tech Stack:** TypeScript, React, Fastify, Prisma, Keycloak 24 Admin API, HashiCorp Vault AppRole, matrix-js-sdk, Jitsi Meet, Synapse Admin API

**Spec:** `docs/superpowers/specs/2026-03-21-vault-passkey-chat-design.md`

---

## Chunk 1: Vault Production Mode (#97)

### Task 1: Update vault-client.ts — AppRole Auth

**Files:**
- Modify: `hub-api/src/lib/vault-client.ts`

**Note:** The existing vault-client uses KV v2 (not transit). Encryption is done client-side in `prisma-encryption.ts` using AES-256-GCM. We keep this pattern — only change the auth method from static `VAULT_TOKEN` to AppRole `role_id + secret_id`.

- [ ] **Step 1: Add AppRole login function**

```typescript
// Add above getEncryptionKey()

interface VaultTokenCache {
  token: string;
  expiresAt: number; // Date.now() + lease_duration * 1000
}

let tokenCache: VaultTokenCache | null = null;

/**
 * Authenticates to Vault via AppRole and returns a client token.
 * Caches the token and auto-renews 30s before expiry.
 */
async function getVaultToken(): Promise<string> {
  // Legacy: if VAULT_TOKEN is set, use it directly (backwards compat)
  const legacyToken = process.env.VAULT_TOKEN;
  if (legacyToken) return legacyToken;

  // Check cache
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }

  const vaultAddr = process.env.VAULT_ADDR;
  const roleId = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;

  if (!vaultAddr || !roleId || !secretId) {
    throw new Error(
      "Missing Vault env: VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID (or VAULT_TOKEN for legacy)"
    );
  }

  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/auth/approle/login`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
  });

  if (!response.ok) {
    throw new Error(`Vault AppRole login failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as {
    auth?: { client_token?: string; lease_duration?: number };
  };

  const token = body?.auth?.client_token;
  const leaseDuration = body?.auth?.lease_duration ?? 3600;

  if (!token) {
    throw new Error("Vault AppRole login response missing client_token");
  }

  tokenCache = {
    token,
    expiresAt: Date.now() + leaseDuration * 1000,
  };

  return token;
}
```

- [ ] **Step 2: Update getEncryptionKey() to use getVaultToken()**

Replace the existing `getEncryptionKey()`:

```typescript
export async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const vaultAddr = process.env.VAULT_ADDR;
  if (!vaultAddr) {
    throw new Error("VAULT_ADDR environment variable is not set");
  }

  const vaultToken = await getVaultToken();
  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/${VAULT_SECRET_PATH}`;

  const response = await fetch(url, {
    headers: {
      "X-Vault-Token": vaultToken,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Vault read failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as {
    data?: { data?: { key?: string } };
  };

  const keyHex = body?.data?.data?.key;
  if (!keyHex) {
    throw new Error(`Vault secret at ${VAULT_SECRET_PATH} is missing the "key" field`);
  }

  const keyBuffer = Buffer.from(keyHex, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes (AES-256), got ${keyBuffer.length}`);
  }

  cachedKey = keyBuffer;
  return cachedKey;
}
```

- [ ] **Step 3: Update clearKeyCache() to also clear token cache**

```typescript
export function clearKeyCache(): void {
  cachedKey = null;
  tokenCache = null;
}
```

- [ ] **Step 4: Build and verify**

Run: `cd hub-api && npm run build`
Expected: Clean compile, no errors

- [ ] **Step 5: Commit**

```bash
git add hub-api/src/lib/vault-client.ts
git commit -m "feat: vault-client AppRole auth with legacy VAULT_TOKEN fallback (#97)"
```

### Task 2: Update Installer — Vault Server Mode

**Files:**
- Modify: `cloudflare/workers/hubport-cloud/src/installer.ts` (in infrastructure repo)

- [ ] **Step 1: Replace Vault docker-compose config**

Find the vault service in the docker-compose heredoc and replace:

**Old (dev mode):**
```yaml
vault:
  image: hashicorp/vault:1.15
  cap_add: [IPC_LOCK]
  command: server -dev
  environment:
    - VAULT_DEV_ROOT_TOKEN_ID=$VAULT_DEV_TOKEN
    - VAULT_ADDR=http://0.0.0.0:8200
```

**New (server mode):**
```yaml
vault:
  image: hashicorp/vault:1.15
  cap_add: [IPC_LOCK]
  command: vault server -config=/vault/config/vault.hcl
  environment:
    - VAULT_ADDR=http://0.0.0.0:8200
  volumes:
    - vault-data:/vault/data
    - ./vault-config.hcl:/vault/config/vault.hcl:ro
  healthcheck:
    test: ["CMD", "vault", "status", "-address=http://127.0.0.1:8200"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 10s
```

- [ ] **Step 2: Generate vault-config.hcl in installer**

Add before docker-compose generation:
```bash
cat > "$INSTALL_DIR/vault-config.hcl" << 'VAULTCFG'
storage "file" {
  path = "/vault/data"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}
api_addr     = "http://vault:8200"
disable_mlock = true
ui            = false
VAULTCFG
```

- [ ] **Step 3: Replace Vault init sequence in installer**

Find the existing dev-mode vault setup and replace with:

```bash
# ── Vault Init (production mode) ──
step "Initializing Vault..."
VAULT_CONTAINER="${SLUG}-vault-1"

# Wait for Vault to be ready
for i in $(seq 1 30); do
  if docker exec "$VAULT_CONTAINER" vault status -address=http://127.0.0.1:8200 2>&1 | grep -q "Initialized.*false"; then
    break
  fi
  sleep 1
done

# Initialize with single key (appropriate for self-hosted tenant)
VAULT_INIT=$(docker exec "$VAULT_CONTAINER" vault operator init \
  -address=http://127.0.0.1:8200 \
  -key-shares=1 -key-threshold=1 -format=json 2>/dev/null)

UNSEAL_KEY=$(printf '%s' "$VAULT_INIT" | python3 -c "import sys,json; print(json.load(sys.stdin)['unseal_keys_b64'][0])")
ROOT_TOKEN=$(printf '%s' "$VAULT_INIT" | python3 -c "import sys,json; print(json.load(sys.stdin)['root_token'])")

# Save unseal key securely
printf '%s' "$VAULT_INIT" > "$INSTALL_DIR/.vault-keys"
chmod 600 "$INSTALL_DIR/.vault-keys"

# Unseal
docker exec "$VAULT_CONTAINER" vault operator unseal -address=http://127.0.0.1:8200 "$UNSEAL_KEY"

# Enable KV v2 secrets engine
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault secrets enable -version=2 secret 2>/dev/null || true

# Generate and store encryption key
ENC_KEY=$(openssl rand -hex 32)
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault kv put secret/hubport/encryption-key key="$ENC_KEY"

# Create hub-api policy (KV read-only for encryption key)
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" sh -c 'vault policy write hub-api - <<POLICY
path "secret/data/hubport/encryption-key" {
  capabilities = ["read"]
}
POLICY'

# Enable AppRole auth
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault auth enable approle 2>/dev/null || true

# Create AppRole for hub-api
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault write auth/approle/role/hub-api \
  token_policies="hub-api" \
  token_ttl=1h \
  token_max_ttl=4h \
  secret_id_ttl=0

# Extract role_id and secret_id
VAULT_ROLE_ID=$(docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault read -field=role_id auth/approle/role/hub-api/role-id)
VAULT_SECRET_ID=$(docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN="$ROOT_TOKEN" \
  "$VAULT_CONTAINER" vault write -f -field=secret_id auth/approle/role/hub-api/custom-secret-id)

ok "Vault initialized with AppRole auth"
```

- [ ] **Step 4: Update .env generation — replace VAULT_TOKEN with AppRole creds**

In the `.env` heredoc, replace:
```bash
VAULT_TOKEN=$VAULT_DEV_TOKEN
```
With:
```bash
VAULT_ROLE_ID=$VAULT_ROLE_ID
VAULT_SECRET_ID=$VAULT_SECRET_ID
```

- [ ] **Step 5: Add auto-unseal entrypoint**

Generate a `vault-unseal.sh` script in the installer:
```bash
cat > "$INSTALL_DIR/vault-unseal.sh" << 'UNSEAL'
#!/bin/sh
# Auto-unseal Vault on container restart
VAULT_ADDR=http://127.0.0.1:8200
KEYS_FILE=/vault-keys/.vault-keys
if [ -f "$KEYS_FILE" ]; then
  UNSEAL_KEY=$(python3 -c "import json; print(json.load(open('$KEYS_FILE'))['unseal_keys_b64'][0])" 2>/dev/null)
  if [ -n "$UNSEAL_KEY" ]; then
    sleep 2
    vault operator unseal -address=$VAULT_ADDR "$UNSEAL_KEY" >/dev/null 2>&1
  fi
fi
UNSEAL
chmod +x "$INSTALL_DIR/vault-unseal.sh"
```

Update vault docker-compose to mount keys and run unseal:
```yaml
volumes:
  - vault-data:/vault/data
  - ./vault-config.hcl:/vault/config/vault.hcl:ro
  - ./.vault-keys:/vault-keys/.vault-keys:ro
  - ./vault-unseal.sh:/vault-unseal.sh:ro
```

- [ ] **Step 6: Remove old dev mode references**

Remove `VAULT_DEV_ROOT_TOKEN_ID` and `VAULT_DEV_TOKEN` variable generation from installer.

- [ ] **Step 7: Build installer**

Run: `cd cloudflare/workers/hubport-cloud && npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 8: Commit**

```bash
git add src/installer.ts
git commit -m "feat: Vault server mode with AppRole auth, auto-unseal (#97)"
```

### Task 3: Test End-to-End

- [ ] **Step 1: Clean install test tenant**

```bash
cd ~/hubport.cloud/pez-north-uat
docker compose down -v
rm -rf ~/hubport.cloud/pez-north-uat
curl -fsSL https://get-uat.hubport.cloud | sh
```

- [ ] **Step 2: Verify Vault is in server mode**

```bash
docker exec pez-north-uat-vault-1 vault status -address=http://127.0.0.1:8200
```
Expected: `Initialized: true`, `Sealed: false`, `Storage Type: file`

- [ ] **Step 3: Verify publisher creation works (encryption key from Vault)**

Log in → Verkündiger → Einladen → create publisher → no error

- [ ] **Step 4: Verify auto-unseal on restart**

```bash
docker compose restart vault
sleep 5
docker exec pez-north-uat-vault-1 vault status -address=http://127.0.0.1:8200
```
Expected: `Sealed: false`

- [ ] **Step 5: Tag and release installer**

```bash
# cf-hubport-cloud
git tag -a v2026.03.21.22 -m "v2026.03.21.22: Vault production mode (#97)"
git push origin --tags
gh release create v2026.03.21.22 --title "v2026.03.21.22 — Vault Production Mode" --notes "..."
```

---

## Chunk 2: Keycloak Passkey Login (#96)

### Task 4: Configure Keycloak WebAuthn in Installer

**Files:**
- Modify: `cloudflare/workers/hubport-cloud/src/installer.ts`

- [ ] **Step 1: Add WebAuthn Passwordless policy to Keycloak setup**

After existing `hub-api` client creation in installer bash, add:

```bash
# ── WebAuthn Passwordless Policy ──
step "Configuring Keycloak WebAuthn..."
docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh update realms/hubport \
  -s 'webAuthnPolicyPasswordlessRpEntityName=hubport' \
  -s "webAuthnPolicyPasswordlessRpId=$SUBDOMAIN.hubport.cloud" \
  -s 'webAuthnPolicyPasswordlessSignatureAlgorithms=["ES256"]' \
  -s 'webAuthnPolicyPasswordlessAttestationConveyancePreference=none' \
  -s 'webAuthnPolicyPasswordlessAuthenticatorAttachment=platform' \
  -s 'webAuthnPolicyPasswordlessRequireResidentKey=Yes' \
  -s 'webAuthnPolicyPasswordlessUserVerificationRequirement=required' 2>/dev/null

# ── Custom Browser Flow with WebAuthn ──
# Copy default browser flow
docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh create \
  authentication/flows/browser/copy -r hubport \
  -s newName="browser-passkey" 2>/dev/null || true

# Get executions and configure alternatives
# Username-password form → ALTERNATIVE
FORMS_FLOW=$(docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh get \
  "authentication/flows/browser-passkey forms/executions" -r hubport 2>/dev/null)

UPFORM_ID=$(printf '%s' "$FORMS_FLOW" | python3 -c "
import sys, json
execs = json.load(sys.stdin)
for e in execs:
    if e.get('providerId') == 'auth-username-password-form':
        print(e['id']); break
")

if [ -n "$UPFORM_ID" ]; then
  docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh update \
    "authentication/flows/browser-passkey forms/executions" -r hubport \
    -b "{\"id\":\"$UPFORM_ID\",\"requirement\":\"ALTERNATIVE\"}" 2>/dev/null
fi

# Add WebAuthn Passwordless authenticator
docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh create \
  "authentication/flows/browser-passkey forms/executions/execution" -r hubport \
  -s provider=webauthn-authenticator-passwordless 2>/dev/null || true

# Set WebAuthn to ALTERNATIVE
WA_ID=$(printf '%s' "$(docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh get \
  "authentication/flows/browser-passkey forms/executions" -r hubport 2>/dev/null)" | python3 -c "
import sys, json
execs = json.load(sys.stdin)
for e in execs:
    if e.get('providerId') == 'webauthn-authenticator-passwordless':
        print(e['id']); break
")

if [ -n "$WA_ID" ]; then
  docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh update \
    "authentication/flows/browser-passkey forms/executions" -r hubport \
    -b "{\"id\":\"$WA_ID\",\"requirement\":\"ALTERNATIVE\"}" 2>/dev/null
fi

# Set custom flow as realm browser flow
docker exec "$KC_CONTAINER" /opt/keycloak/bin/kcadm.sh update realms/hubport \
  -s browserFlow="browser-passkey" 2>/dev/null

ok "Keycloak WebAuthn configured"
```

- [ ] **Step 2: Build installer**

Run: `cd cloudflare/workers/hubport-cloud && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: Keycloak WebAuthn browser flow with passkey login (#96)"
```

### Task 5: Migrate SecurityWizard to Keycloak-Only

**Files:**
- Modify: `hub-api/src/routes/security.ts`
- Modify: `hub-api/src/lib/keycloak-admin.ts`
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add WebAuthn + TOTP methods to keycloak-admin.ts**

```typescript
/** Register a WebAuthn credential for a user in Keycloak */
async registerWebAuthnCredential(userId: string, credential: {
  credentialId: string;
  publicKey: string;
  counter: number;
  label: string;
}): Promise<void> {
  const token = await this.getAdminToken();
  // Keycloak 24: Use the credential representation API
  const res = await fetch(
    `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/credentials`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  // Note: Keycloak's WebAuthn credential registration happens during
  // the authentication flow itself. We trigger a required action instead.
}

/** Add required action to force WebAuthn registration on next login */
async addRequiredAction(userId: string, action: string): Promise<void> {
  const token = await this.getAdminToken();
  const userRes = await fetch(
    `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const user = await userRes.json();
  const actions = user.requiredActions || [];
  if (!actions.includes(action)) {
    actions.push(action);
    await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...user, requiredActions: actions }),
      }
    );
  }
}

/** Configure TOTP for a user via Keycloak Admin API */
async configureTotp(userId: string): Promise<void> {
  await this.addRequiredAction(userId, "CONFIGURE_TOTP");
}

/** Get user credentials from Keycloak */
async getUserCredentials(userId: string): Promise<Array<{ type: string; id: string }>> {
  const token = await this.getAdminToken();
  const res = await fetch(
    `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/credentials`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  return res.json();
}

/** Check if user has WebAuthn credentials */
async hasPasskey(userId: string): Promise<boolean> {
  const creds = await this.getUserCredentials(userId);
  return creds.some(c => c.type === "webauthn-passwordless");
}

/** Check if user has TOTP configured */
async hasTotp(userId: string): Promise<boolean> {
  const creds = await this.getUserCredentials(userId);
  return creds.some(c => c.type === "otp");
}
```

- [ ] **Step 2: Update security.ts — GET /security/status to query Keycloak**

Replace the current status check (reads from hub-api DB) with Keycloak credential query:

```typescript
// GET /security/status
const setup = await prisma.securitySetup.findUnique({
  where: { keycloakSub: request.user.sub },
});

const hasPasskey = await keycloakAdmin.hasPasskey(request.user.sub);
const hasTotp = await keycloakAdmin.hasTotp(request.user.sub);

return {
  passwordChanged: setup?.passwordChanged ?? false,
  passkeyCount: hasPasskey ? 1 : 0,  // Keycloak doesn't expose count easily
  totpConfigured: hasTotp,
  setupComplete: (setup?.passwordChanged ?? false) && (hasPasskey || hasTotp),
};
```

- [ ] **Step 3: Update security.ts — passkey registration to use Keycloak flow**

The passkey registration in SecurityWizard currently stores in hub-api DB. Since Keycloak handles WebAuthn registration via the browser flow itself (not via Admin API), we need to:

1. After password change, add `webauthn-register-passwordless` required action
2. Keycloak will prompt for passkey registration on next page load
3. SecurityWizard becomes a status checker, not a credential manager

```typescript
// POST /security/passkey/setup — trigger Keycloak WebAuthn registration
await keycloakAdmin.addRequiredAction(
  request.user.sub,
  "webauthn-register-passwordless"
);
return { redirect: true }; // Frontend redirects to Keycloak for registration
```

- [ ] **Step 4: Remove TOTP secret storage from hub-api**

SecurityWizard TOTP step: instead of generating/storing TOTP secret locally, trigger Keycloak's CONFIGURE_TOTP required action.

```typescript
// POST /security/totp/setup — trigger Keycloak TOTP configuration
await keycloakAdmin.addRequiredAction(request.user.sub, "CONFIGURE_TOTP");
return { redirect: true }; // Frontend redirects to Keycloak for TOTP setup
```

- [ ] **Step 5: Prisma migration — drop WebAuthnCredential, trim SecuritySetup**

```prisma
// Remove from schema.prisma:
// model WebAuthnCredential { ... }

// Update SecuritySetup — remove TOTP fields:
model SecuritySetup {
  id                String   @id @default(uuid())
  keycloakSub       String   @unique
  passwordChanged   Boolean  @default(false)
  passwordChangedAt DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

Run: `npx prisma db push`

- [ ] **Step 6: Build and verify**

Run: `cd hub-api && npm run build`

- [ ] **Step 7: Commit**

```bash
git add hub-api/
git commit -m "feat: migrate passkey/TOTP to Keycloak-only storage (#96)"
```

### Task 6: Test Keycloak Passkey Login E2E

- [ ] **Step 1: Reinstall tenant with updated installer**
- [ ] **Step 2: First login — password only → SecurityWizard**
- [ ] **Step 3: SecurityWizard triggers Keycloak passkey registration**
- [ ] **Step 4: Logout → login again → Keycloak shows "Sign in with Passkey"**
- [ ] **Step 5: Passkey login works (no password needed)**
- [ ] **Step 6: Try password-only login → Keycloak demands OTP**
- [ ] **Step 7: Tag and release**

---

## Chunk 3: Chat Widget — Core UI (#98a)

### Task 7: Install matrix-js-sdk

**Files:**
- Modify: `hub-app/package.json`

- [ ] **Step 1: Install dependency**

```bash
cd hub-app && npm install matrix-js-sdk
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add matrix-js-sdk dependency (#98)"
```

### Task 8: Matrix Client Wrapper

**Files:**
- Create: `hub-app/src/lib/matrix-client.ts`

- [ ] **Step 1: Create matrix client wrapper**

```typescript
/**
 * Matrix client wrapper for hubport chat.
 * Handles init, sync, send, and room management.
 */
import { createClient, MatrixClient, Room, MatrixEvent } from "matrix-js-sdk";

let client: MatrixClient | null = null;

export interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  body: string;
  timestamp: number;
  type: "text" | "image" | "file";
}

export interface ChatRoom {
  id: string;
  name: string;
  topic?: string;
  isSpace: boolean;
  isDirect: boolean;
  unreadCount: number;
  lastMessage?: ChatMessage;
  members: number;
  avatarUrl?: string;
}

export async function initMatrixClient(
  homeserverUrl: string,
  accessToken: string,
  userId: string,
): Promise<MatrixClient> {
  if (client) return client;

  client = createClient({
    baseUrl: homeserverUrl,
    accessToken,
    userId,
  });

  await client.startClient({ initialSyncLimit: 20 });
  return client;
}

export function getMatrixClient(): MatrixClient | null {
  return client;
}

export async function stopMatrixClient(): Promise<void> {
  if (client) {
    client.stopClient();
    client = null;
  }
}

export async function sendMessage(roomId: string, body: string): Promise<void> {
  if (!client) throw new Error("Matrix client not initialized");
  await client.sendTextMessage(roomId, body);
}

export function getRooms(): ChatRoom[] {
  if (!client) return [];
  return client.getRooms()
    .filter(r => r.getMyMembership() === "join")
    .map(roomToChatRoom);
}

function roomToChatRoom(room: Room): ChatRoom {
  const lastEvent = room.timeline[room.timeline.length - 1];
  return {
    id: room.roomId,
    name: room.name || "Unnamed",
    topic: room.currentState.getStateEvents("m.room.topic", "")?.[0]?.getContent()?.topic,
    isSpace: room.isSpaceRoom?.() ?? false,
    isDirect: Object.keys(room.client.getAccountData("m.direct")?.getContent() ?? {}).some(
      uid => room.client.getAccountData("m.direct")?.getContent()[uid]?.includes(room.roomId)
    ),
    unreadCount: room.getUnreadNotificationCount("total") ?? 0,
    lastMessage: lastEvent ? eventToMessage(lastEvent) : undefined,
    members: room.getJoinedMemberCount(),
    avatarUrl: room.getAvatarUrl(room.client.getHomeserverUrl(), 40, 40, "crop") ?? undefined,
  };
}

function eventToMessage(event: MatrixEvent): ChatMessage {
  return {
    id: event.getId() ?? "",
    sender: event.getSender() ?? "",
    senderName: event.sender?.name ?? event.getSender() ?? "",
    body: event.getContent()?.body ?? "",
    timestamp: event.getTs(),
    type: "text",
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hub-app/src/lib/matrix-client.ts
git commit -m "feat: matrix-js-sdk client wrapper (#98)"
```

### Task 9: Chat Widget Component

**Files:**
- Create: `hub-app/src/components/chat/ChatWidget.tsx`
- Create: `hub-app/src/components/chat/ConversationList.tsx`
- Create: `hub-app/src/components/chat/MessageThread.tsx`
- Create: `hub-app/src/components/chat/MessageInput.tsx`
- Create: `hub-app/src/components/chat/SpaceTree.tsx`
- Modify: `hub-app/src/components/Layout.tsx` — render ChatWidget

This is the largest task. Each component file is detailed below.

- [ ] **Step 1: Create ChatWidget.tsx — main container**

Widget states: collapsed (bubble), expanded (conversation list), thread (messages).
Glassmorphism styling. Bottom-right fixed position. Full-screen on mobile.

- [ ] **Step 2: Create ConversationList.tsx — left panel**

Search bar, pill tabs (Alle/Spaces/DMs/Ungelesen), conversation items with avatar + name + preview + timestamp.

- [ ] **Step 3: Create SpaceTree.tsx — collapsible space/channel tree**

Renders pre-seeded spaces with nested channels. RBAC badges. Unread counts.

- [ ] **Step 4: Create MessageThread.tsx — right panel**

Message bubbles (sender left, own right). Avatar + name + timestamp. Scroll to bottom on new messages.

- [ ] **Step 5: Create MessageInput.tsx — input bar**

Text input with attachment buttons (image, file, emoji). Send button. Typing indicator.

- [ ] **Step 6: Mount ChatWidget in Layout.tsx**

```tsx
// In Layout.tsx, add after main content:
<ChatWidget />
```

- [ ] **Step 7: Remove old Chat page iframe**

Delete: `hub-app/src/pages/chat/Chat.tsx` (Element iframe)
Update: `App.tsx` — route `/chat` → ChatWidget (or remove route, widget is global)

- [ ] **Step 8: Build and verify**

```bash
cd hub-app && npm run build
```

- [ ] **Step 9: Commit**

```bash
git add hub-app/src/components/chat/ hub-app/src/components/Layout.tsx hub-app/src/App.tsx
git commit -m "feat: LinkedIn-style chat widget with matrix-js-sdk (#98)"
```

---

## Chunk 4: Pre-Seeded Spaces + RBAC + Campaigns (#98b)

### Task 10: Matrix Admin API Client (hub-api)

**Files:**
- Create: `hub-api/src/lib/matrix-admin.ts`
- Create: `hub-api/src/lib/matrix-rooms.ts`

- [ ] **Step 1: Create matrix-admin.ts — Synapse Admin API client**

Functions: createUser, createRoom, createSpace, inviteToRoom, setRoomPowerLevels

- [ ] **Step 2: Create matrix-rooms.ts — pre-seeded space definitions**

Define default spaces and channels. Auto-provision on first boot.

- [ ] **Step 3: Commit**

### Task 11: Chat Settings API (hub-api)

**Files:**
- Create: `hub-api/src/routes/chat.ts`
- Modify: `hub-api/prisma/schema.prisma` — add ChatSettings model

- [ ] **Step 1: Add ChatSettings model**

```prisma
model ChatSettings {
  id             String  @id @default(uuid())
  dmsEnabled     Boolean @default(true)
  callsEnabled   Boolean @default(true)
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 2: Create chat routes**

`GET /chat/settings` — returns DM/call toggle state
`PUT /chat/settings` — update toggles (elder only)

- [ ] **Step 3: Commit**

### Task 12: Campaign Spaces

**Files:**
- Modify: `hub-api/prisma/schema.prisma` — add Campaign model
- Create: `hub-api/src/routes/campaigns.ts`

- [ ] **Step 1: Add Campaign model**

```prisma
model Campaign {
  id          String         @id @default(uuid())
  title       String
  template    CampaignTemplate
  startDate   DateTime
  endDate     DateTime
  matrixRoomId String?
  createdBy   String         // keycloakSub
  invitations CampaignInvite[]
  createdAt   DateTime       @default(now())
  deletedAt   DateTime?      // auto-delete 7 days after endDate
}

enum CampaignTemplate {
  gedaechtnismahl
  kongress
  predigtdienstaktion
  custom
}

model CampaignInvite {
  id          String    @id @default(uuid())
  campaign    Campaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  campaignId  String
  publisher   Publisher @relation(fields: [publisherId], references: [id])
  publisherId String
  status      InviteStatus @default(pending)
  respondedAt DateTime?
  @@unique([campaignId, publisherId])
}

enum InviteStatus {
  pending
  accepted
  unavailable
}
```

- [ ] **Step 2: Create campaign routes**

`POST /campaigns` — create campaign (requires `chat:createCampaign`)
`GET /campaigns` — list active campaigns
`POST /campaigns/:id/respond` — accept/decline invitation
`GET /campaigns/:id/participants` — participation overview
Auto-delete cron: campaigns where `endDate + 7 days < now()`

- [ ] **Step 3: Commit**

---

## Chunk 5: Jitsi Calls + Profile Pictures (#98c-d)

### Task 13: Profile Pictures

**Files:**
- Modify: `hub-api/prisma/schema.prisma` — add `avatarUrl` to Publisher
- Modify: `hub-api/src/routes/publishers.ts` — avatar upload endpoint
- Modify: `hub-app/src/pages/publishers/PublisherForm.tsx` — avatar upload UI

- [ ] **Step 1: Add avatarUrl to Publisher model**
- [ ] **Step 2: Create upload endpoint with image resize**
- [ ] **Step 3: Sync avatar to Matrix user via Synapse Admin API**
- [ ] **Step 4: Commit**

### Task 14: Jitsi Integration

**Files:**
- Modify: `cloudflare/workers/hubport-cloud/src/installer.ts` — add Jitsi container
- Create: `hub-app/src/components/chat/CallControls.tsx`

- [ ] **Step 1: Add Jitsi container to docker-compose**
- [ ] **Step 2: Create CallControls component**
- [ ] **Step 3: Wire call button in MessageThread header**
- [ ] **Step 4: Commit**

### Task 15: Landing Page Update

**Files:**
- Modify: `cloudflare/workers/hubport-cloud/src/pages/home.ts`
- Modify: `cloudflare/workers/hubport-cloud/src/pages/features.ts`
- Modify: `cloudflare/workers/hubport-cloud/src/i18n/en.ts`
- Modify: `cloudflare/workers/hubport-cloud/src/i18n/de.ts`

- [ ] **Step 1: Add chat trust card to home page**
- [ ] **Step 2: Add chat section to features page with mockup screenshot**
- [ ] **Step 3: Add FAQ entry**
- [ ] **Step 4: Deploy to UAT**
- [ ] **Step 5: Commit + tag + release**

---

## Final Verification

- [ ] Full tenant reinstall: `curl -fsSL https://get-uat.hubport.cloud | sh`
- [ ] Vault: server mode, AppRole auth, encryption works
- [ ] Keycloak: passkey login, OTP fallback, password-only blocked after setup
- [ ] Chat widget: opens from navbar icon, Spaces visible, messages work
- [ ] DMs: publisher-to-publisher messaging
- [ ] Campaigns: create Gedächtnismahleinladung → invite → accept/decline
- [ ] Calls: 1:1 Jitsi call, group call in space
- [ ] Profile pics: upload → visible in chat + publisher list
- [ ] Mobile: full-screen chat overlay
- [ ] Landing page: chat feature cards + FAQ
