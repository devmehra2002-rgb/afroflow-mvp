import crypto from "crypto";

// Encrypts the Gmail refresh token before it is stored. Key: GMAIL_TOKEN_KEY (64 hex chars = 32 bytes).
function key(): Buffer {
  const k = process.env.GMAIL_TOKEN_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error("GMAIL_TOKEN_KEY must be 64 hex characters");
  return Buffer.from(k, "hex");
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
