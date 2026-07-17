import { expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../../src/http/content-security-policy";

it("builds a nonce-based CSP without permissive script directives", () => {
  const policy = buildContentSecurityPolicy("fixed-nonce");
  expect(policy).toContain("script-src 'self' 'nonce-fixed-nonce' 'strict-dynamic'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy.slice(0, policy.indexOf("style-src"))).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");
});
