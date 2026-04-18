# GIS Migration Plan for PLAT Authority (Hard Rollout)

## Overview
This plan details the steps to migrate the authority/ OAuth implementation to Google Identity Services (GIS) with a **hard rollout**—legacy OAuth flows will be fully removed, and only GIS-compliant authentication will be supported. All clients (browser and non-browser) must migrate to GIS/ID token flows before deployment. No legacy OAuth or code-based flows will be maintained.

---

## 1. Current OAuth Implementation
- Uses Google OAuth 2.0 code flow (server-side) for browser clients.
- Endpoints: `/oauthStart`, `/oauthCallback` (see `src/server.ts`).
- Custom service: `src/services/google-oauth-service.ts` handles code exchange, token fetch, and profile lookup.
- State/redirect logic: `src/services/oauth-redirect-service.ts`.
- Config via environment variables (client ID, secret, redirect URI).
- **All of this will be replaced with GIS-only logic.**

---

## 2. GIS and Multi-Client Support Requirements
- **Browser clients:** Must use GIS JS SDK for ID token acquisition (no code exchange).
- **Non-browser clients:**
  - **Service accounts:** Must use saved private key (JSON) to mint and sign JWTs, exchange for ID tokens.
  - **CLI tools:** Must use device code flow, installed app flow, or service account keys to obtain ID tokens.
- **Server will only accept and verify:**
  - GIS ID tokens (browser, CLI, service account)
  - **No legacy code flow or code exchange will be supported.**

---

## 3. Key Differences: Legacy OAuth vs GIS (Hard Rollout)
- GIS emphasizes ID tokens and client-side flows.
- Legacy OAuth (code exchange, refresh tokens, etc.) will be **fully removed**.
- GIS tokens are verified using Google public keys (`google-auth-library`).
- Service accounts/CLI tools use saved secrets for non-interactive auth.

---

## 4. Required Code and Config Changes

### a. Update/Refactor Services
- `src/services/google-oauth-service.ts`:
  - Remove all code exchange and legacy OAuth logic.
  - Implement ID token verification using `google-auth-library` (`OAuth2Client` or `GoogleAuth`).
  - Only accept and verify ID tokens (from browser, service account, or CLI).
- `src/server.ts`:
  - Update `/oauthCallback` to only accept and verify ID tokens.
  - Remove any endpoints or logic related to code exchange or legacy OAuth.
- `src/services/oauth-redirect-service.ts`:
  - Ensure state/redirect logic is compatible with GIS-only flows.

### b. Configuration
- Add GIS client ID(s) and allowed audiences to config/env.
- Document service account key usage for non-browser clients.
- Remove all legacy OAuth secrets/config.

### c. Tests
- `tests/oauth-redirect-service.test.mjs`:
  - Remove legacy flow tests.
  - Add tests for ID token verification (browser, service account, CLI).

### d. Documentation
- Update `authority/README.md`:
  - Remove all references to legacy OAuth and code exchange.
  - Document browser GIS flow and non-browser (service account/CLI) flows only.
  - Provide examples for each client type.
  - Add security notes on secret handling and audience checks.

### e. Dependencies
- Add `google-auth-library` to `package.json` if not present.
- Remove all unused legacy OAuth libraries.

---

## 5. Migration Steps (Hard Rollout)
- **Step 1:** Implement GIS/ID token-only support in all relevant code and configuration.
- **Step 2:** Update all clients (browser, CLI, service account) to use GIS/ID token flows.
- **Step 3:** Remove all legacy OAuth code, endpoints, and documentation.
- **Step 4:** Deploy only after all clients are confirmed to be GIS/ID token compatible.
- **Step 5:** Validate with real Google accounts and tokens.
- **Step 6:** Monitor for issues and iterate as needed (no rollback to legacy flows).

---

## 6. Security Considerations
- Service account/CLI secrets must be stored securely (never in browser code).
- Server must check `aud` (audience) and `iss` (issuer) in all tokens.
- Rotate secrets regularly and restrict permissions.

---

## 7. Example Token Verification Logic
- Accept token from client (ID token or JWT).
- Verify with `OAuth2Client`/`GoogleAuth`, check audience/issuer.
- Extract subject/email/roles from verified token.
- **Reject any code-based or legacy OAuth tokens.**

---

## 8. File/Change Checklist
| File/Folder                                      | Action/Change                                                                 |
|--------------------------------------------------|-------------------------------------------------------------------------------|
| src/services/google-oauth-service.ts             | Remove legacy OAuth, implement GIS-only ID token verification                 |
| src/services/oauth-redirect-service.ts           | Ensure compatibility, update state/redirect logic if needed                   |
| src/server.ts                                    | Remove legacy endpoints, support GIS/ID token only                            |
| src/config/ (or env usage in server.ts)          | Add GIS client ID, remove all legacy secrets                                  |
| tests/oauth-redirect-service.test.mjs            | Remove legacy tests, add GIS/ID token tests                                   |
| README.md                                        | Remove legacy OAuth docs, add GIS/ID token docs                               |
| package.json                                     | Add `google-auth-library`, remove unused OAuth deps                           |

---

## 9. Further Considerations (Hard Rollout)
- All clients must migrate to GIS/ID token flows before deployment.
- Any client not updated will be unable to authenticate.
- Validate with real Google accounts and tokens before rollout.
- Monitor for issues and iterate as needed (no rollback to legacy flows).
