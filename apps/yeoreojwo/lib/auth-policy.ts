/** Reject unverified identity headers in standalone Google OAuth deployments.
 * The legacy header protocol is only for the existing, access-controlled
 * ChatGPT Sites proxy and must not be used as public authentication.
 */
export function allowLegacyProxyIdentity(config: Record<string, unknown>): boolean {
  return !(typeof config.GOOGLE_CLIENT_ID === 'string' && config.GOOGLE_CLIENT_ID.trim().length > 0);
}
