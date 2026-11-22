import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "../src/lib/gmail/crypto";
import { rawMail } from "../src/lib/gmail/client";
import { shouldSkip } from "../src/lib/gmail/sync";
import { parseGmailMessage } from "../src/lib/intake/rules";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

process.env.GMAIL_TOKEN_KEY = "a".repeat(64);
ok("token encrypts and decrypts back", () => {
  const e = encryptToken("1//refresh-token-value");
  assert.notEqual(e, "1//refresh-token-value");
  assert.equal(decryptToken(e), "1//refresh-token-value");
});
ok("same token encrypts differently each time", () => assert.notEqual(encryptToken("x"), encryptToken("x")));
ok("tampered token is refused", () => {
  const parts = encryptToken("secret").split(".");
  parts[2] = Buffer.from("tampered!").toString("base64");
  assert.throws(() => decryptToken(parts.join(".")));
});
ok("bad key is refused", () => {
  const k = process.env.GMAIL_TOKEN_KEY; process.env.GMAIL_TOKEN_KEY = "short";
  assert.throws(() => encryptToken("x")); process.env.GMAIL_TOKEN_KEY = k;
});
ok("raw mail has To, plain subject, and a decodable body", () => {
  const raw = Buffer.from(rawMail("buyer@x.com", "Re: Quote", "Hello ₹100"), "base64url").toString();
  assert.match(raw, /^To: buyer@x\.com/);
  assert.match(raw, /Subject: Re: Quote/);
  assert.equal(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString("utf8"), "Hello ₹100");
});
ok("non-ASCII subject is encoded", () => assert.match(Buffer.from(rawMail("a@b.c", "Prix – été", "x"), "base64url").toString(), /Subject: =\?UTF-8\?B\?/));
ok("a full Gmail API message is read as from/subject/body/date", () => {
  const m = parseGmailMessage({ id: "m1", internalDate: "1700000000000", payload: { headers: [{ name: "From", value: "A <a@b.com>" }, { name: "Subject", value: "Hi" }], mimeType: "text/plain", body: { data: Buffer.from("Need 2 containers").toString("base64url") } } } as never);
  assert.equal(m.messageId, "m1"); assert.equal(m.from, "A <a@b.com>"); assert.equal(m.body, "Need 2 containers"); assert.ok(m.date);
});
ok("skips social/promotions, own mail, reminders, non-inbox; keeps primary and updates", () => {
  assert.equal(shouldSkip(["INBOX", "CATEGORY_PERSONAL"], "b@x.com", "me@g.com", "Quote"), false);
  assert.equal(shouldSkip(["INBOX", "CATEGORY_UPDATES"], "b@x.com", "me@g.com", "Quote"), false);
  assert.equal(shouldSkip(["INBOX", "CATEGORY_SOCIAL"], "invitations@linkedin.com", "me@g.com", "x"), true);
  assert.equal(shouldSkip(["INBOX", "CATEGORY_PROMOTIONS"], "a@b.c", "me@g.com", "x"), true);
  assert.equal(shouldSkip(["SENT"], "me@g.com", "me@g.com", "x"), true);
  assert.equal(shouldSkip(["INBOX"], "ME@g.com".toLowerCase(), "me@g.com", "x"), true);
  assert.equal(shouldSkip(["INBOX"], "b@x.com", "me@g.com", "AfroFlow reminder: Quote"), true);
  assert.equal(shouldSkip(["CATEGORY_PERSONAL"], "b@x.com", "me@g.com", "x"), true);
});
console.log(`\n${n} checks passed`);
