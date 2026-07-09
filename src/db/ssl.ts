/**
 * TLS configuration for the Postgres pool.
 *
 * Managed Postgres (Supabase and other hosted providers) requires TLS. This
 * derives a sensible `ssl` option from the connection string so the app works
 * against Supabase in production and plaintext localhost in local dev, with no
 * per-environment code changes.
 *
 * - `sslmode=disable` in the URL, or localhost/127.0.0.1 → no TLS.
 * - Any other (remote) host, `sslmode=require`, or `PGSSLMODE=require` → TLS on.
 * - CA verification is on by default; set `DATABASE_SSL_NO_VERIFY=true` only if a
 *   provider presents a cert that the system CA store cannot verify.
 */
export function poolSsl(
  connectionString: string,
): false | { rejectUnauthorized: boolean } {
  if (/sslmode=disable/i.test(connectionString)) return false;

  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|::1)(:|\/)/i.test(connectionString);
  const wantSsl =
    /sslmode=(require|verify-full|verify-ca|prefer)/i.test(connectionString) ||
    process.env.PGSSLMODE === 'require' ||
    !isLocal;

  if (!wantSsl) return false;
  return { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== 'true' };
}
