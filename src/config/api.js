/**
 * Where the app talks to.
 *
 * One constant, compiled in. It used to be a default in three files that a
 * "Wi-Fi Server Connection Settings" box on the login screen could overwrite in
 * AsyncStorage — handy while developing against a laptop, and a trap in
 * production: a phone that had once been pointed at 192.168.x.x kept going
 * there after the real build was installed, and nothing on screen said why.
 */
export const API_URL = 'https://sfa.buyonegram.com/api';

export default API_URL;

/** Where the server itself lives, without the `/api` on the end. */
export const SERVER_URL = API_URL.replace(/\/api\/?$/, '');

/**
 * A file path the server gave us, as something `<Image>` can actually load.
 *
 * Branding comes back as "/assets/logo.png" — fine in a browser sitting on the
 * same host, meaningless on a phone, which is why the login screen showed the
 * fallback text instead of the logo. An absolute URL is passed through
 * untouched, so a logo held on Firebase still works.
 */
export const fileUrl = (path) => {
  const value = String(path || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${SERVER_URL}${value.startsWith('/') ? '' : '/'}${value}`;
};
