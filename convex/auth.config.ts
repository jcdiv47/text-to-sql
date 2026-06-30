/**
 * Validates Clerk-issued JWTs. `applicationID` must match the name of the Clerk
 * JWT template ("convex"); `domain` is the Clerk Frontend API / issuer URL, set
 * in the Convex deployment env as CLERK_JWT_ISSUER_DOMAIN (dashboard or
 * `npx convex env set`).
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
