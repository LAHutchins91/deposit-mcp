/** The configured base only. This repo does not add a production host. */
export function canonicalPublicOrigin(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/$/, "");
}
