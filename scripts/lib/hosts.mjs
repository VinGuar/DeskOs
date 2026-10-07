// Host allow-list for fixtures (SPEC 10.4). Fixtures may only name reserved
// example domains and localhost. Extend deliberately, with a DECISIONS.md note.

const ALLOWED_HOSTS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /(^|\.)example\.(com|org|net)$/,
  /\.(test|invalid|example|localhost)$/,
];

/** @param {string} host */
export const isAllowedHost = (host) => ALLOWED_HOSTS.some((re) => re.test(host.toLowerCase()));

/**
 * URL hosts and email domains in text that are not on the allow-list.
 * @param {string} text
 * @returns {string[]}
 */
export function findDisallowedHosts(text) {
  /** @type {Set<string>} */
  const hosts = new Set();
  for (const m of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) {
    if (m[1]) hosts.add(m[1]);
  }
  for (const m of text.matchAll(/\b[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)) {
    if (m[1]) hosts.add(m[1]);
  }
  return [...hosts].filter((h) => !isAllowedHost(h)).sort();
}
