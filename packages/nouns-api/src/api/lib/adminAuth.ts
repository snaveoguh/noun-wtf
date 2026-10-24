// ============================================================
// Admin + wallet-signature gates for the privileged agent routes
// ============================================================
//
// CORS only stops browsers; `curl` ignores it. Every route that spends
// Claude / RPC / gas or writes to the repo goes through one of these.

import type { Context, MiddlewareHandler } from 'hono';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getAddress, isAddress, verifyMessage, type Hex } from 'viem';

export const ADMIN_HEADER = 'x-agent-secret';

type HeaderReader = { req: { header: (k: string) => string | undefined } };

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * True only when AGENT_ADMIN_SECRET is set AND the request carries it in
 * `x-agent-secret`. Fails closed: with the env var unset nobody is admin
 * (no localhost fallback — the Host header is attacker-controlled).
 */
export function isAdminRequest(c: HeaderReader): boolean {
  const secret = process.env.AGENT_ADMIN_SECRET;
  const given = c.req.header(ADMIN_HEADER);
  if (!secret || !given) return false;
  // Hash both sides so the compare is constant-time regardless of length.
  return timingSafeEqual(digest(given), digest(secret));
}

/** 401 without the header, 403 with a wrong one or when no secret is configured. */
export function adminDenial(c: HeaderReader): { error: string; status: 401 | 403 } | null {
  if (isAdminRequest(c)) return null;
  if (!process.env.AGENT_ADMIN_SECRET) {
    return { error: 'admin endpoint disabled (AGENT_ADMIN_SECRET is not set)', status: 403 };
  }
  if (!c.req.header(ADMIN_HEADER)) return { error: `${ADMIN_HEADER} header required`, status: 401 };
  return { error: 'forbidden', status: 403 };
}

/** Hono middleware form of `adminDenial`. */
export const requireAdmin: MiddlewareHandler = async (c: Context, next) => {
  const denied = adminDenial(c);
  if (denied) return c.json({ error: denied.error }, denied.status);
  await next();
};

// ─── Signed deploy requests (EIP-191 personal_sign) ─────────────────────────

/** A signed deploy request is valid for at most this long after signing. */
export const DEPLOY_SIGNATURE_MAX_TTL_MS = 10 * 60 * 1000;

export interface DeployAuthFields {
  wallet: string;
  description: string;
  reason?: string;
  nonce: string;
  /** Unix ms after which the signature is refused. */
  expires: number;
}

/**
 * The exact text the wallet signs. Every line above `description:` is a single
 * line (address / nonce / expires are validated, reason is JSON-encoded), and
 * the description comes last verbatim, so no two requests share a message.
 */
export function deployMessage(f: DeployAuthFields): string {
  return [
    'noun.wtf agent deploy',
    `address: ${f.wallet.toLowerCase()}`,
    `nonce: ${f.nonce}`,
    `expires: ${f.expires}`,
    `reason: ${JSON.stringify(f.reason ?? '')}`,
    'description:',
    f.description,
  ].join('\n');
}

export const newDeployNonce = () => randomBytes(16).toString('hex');

const NONCE_RE = /^[\dA-Za-z]{16,64}$/;

/** Single-use nonces, kept until their signature would have expired anyway. */
const usedNonces = new Map<string, number>();

function pruneNonces(now: number) {
  for (const [k, exp] of usedNonces) if (exp < now) usedNonces.delete(k);
}

export type SignatureVerifier = (address: Hex, message: string, signature: Hex) => Promise<boolean>;

/** EOA signature first, then ERC-1271 (Safes, smart accounts) through `client`. */
export function makeSignatureVerifier(client?: {
  verifyMessage: (a: { address: Hex; message: string; signature: Hex }) => Promise<boolean>;
}): SignatureVerifier {
  return async (address, message, signature) => {
    try {
      if (await verifyMessage({ address, message, signature })) return true;
    } catch {
      /* fall through to ERC-1271 */
    }
    if (!client) return false;
    try {
      return await client.verifyMessage({ address, message, signature });
    } catch {
      return false;
    }
  };
}

/**
 * Proves `body.wallet` signed this exact deploy request. Check this BEFORE the
 * Noun balance: an unproven address says nothing about who is asking.
 * Consumes the nonce on success, so a signature works once.
 */
export async function checkDeploySignature(
  body: Record<string, unknown>,
  verify: SignatureVerifier,
  now = Date.now(),
): Promise<{ wallet: Hex } | { error: string; status: 400 | 401 | 409 }> {
  const { wallet, description, reason, nonce, expires, signature } = body;
  if (typeof wallet !== 'string' || !isAddress(wallet)) {
    return { error: 'wallet must be an address', status: 400 };
  }
  if (typeof description !== 'string' || !description) {
    return { error: 'description is required', status: 400 };
  }
  if (reason !== undefined && typeof reason !== 'string') {
    return { error: 'reason must be a string', status: 400 };
  }
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) {
    return { error: 'nonce must be 16-64 alphanumeric characters', status: 400 };
  }
  if (typeof expires !== 'number' || !Number.isSafeInteger(expires)) {
    return { error: 'expires must be a unix-ms integer', status: 400 };
  }
  if (typeof signature !== 'string' || !/^0x[\da-f]+$/i.test(signature)) {
    return { error: 'signature is required', status: 401 };
  }
  if (expires < now) return { error: 'signature expired', status: 401 };
  if (expires > now + DEPLOY_SIGNATURE_MAX_TTL_MS) {
    return { error: 'expires is more than 10 minutes away', status: 400 };
  }
  pruneNonces(now);
  if (usedNonces.has(nonce)) return { error: 'nonce already used', status: 409 };

  const address = getAddress(wallet);
  const message = deployMessage({ wallet: address, description, reason, nonce, expires });
  if (!(await verify(address, message, signature as Hex))) {
    return { error: 'signature does not match wallet', status: 401 };
  }
  // Re-check after the await: two concurrent requests could carry one nonce.
  if (usedNonces.has(nonce)) return { error: 'nonce already used', status: 409 };
  usedNonces.set(nonce, expires);
  return { wallet: address };
}

/** Test hook. */
export function _resetDeployNonces() {
  usedNonces.clear();
}
