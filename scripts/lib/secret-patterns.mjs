// Patterns for likely secrets. Used by the pre-commit hook, CI, and the
// fixture hygiene test. gitleaks runs in CI as a second, independent layer.

/** @typedef {{ id: string, re: RegExp }} SecretRule */

/** @type {SecretRule[]} */
export const SECRET_RULES = [
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "slack-token", re: /\bxox[abprse]-[A-Za-z0-9-]{10,}/ },
  { id: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-style-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: "stripe-live-key", re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
  { id: "private-key-block", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    id: "url-with-password",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"'`]+:[^\s@/"'`]{6,}@[^\s"'`]+/i,
  },
  {
    id: "assigned-secret",
    re: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
  },
];

/** Values that look like placeholders, not real secrets. */
const PLACEHOLDER = /\$\{|<[^>]*>|x{4,}|\*{4,}|example|changeme|placeholder|dummy|redacted/i;

export const SECRET_ALLOW_MARKER = "secret-scan-allow";

/**
 * @typedef {{ line: number, rule: string, preview: string }} SecretHit
 */

/**
 * Find likely secrets. The preview never contains the full value.
 * @param {string} text
 * @returns {SecretHit[]}
 */
export function findSecrets(text) {
  /** @type {SecretHit[]} */
  const hits = [];
  text.split(/\r\n?|\n/).forEach((line, i) => {
    if (line.includes(SECRET_ALLOW_MARKER)) return;
    for (const rule of SECRET_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const value = m[1] ?? m[0];
      if (PLACEHOLDER.test(value)) continue;
      hits.push({ line: i + 1, rule: rule.id, preview: `${m[0].slice(0, 4)}...` });
    }
  });
  return hits;
}
