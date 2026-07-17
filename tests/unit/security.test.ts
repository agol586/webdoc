import { expect, it } from "vitest";

import nextConfig from "../../next.config";

it("applies hardened headers to every route without unsafe-eval", async () => {
  const rules = await nextConfig.headers?.();
  expect(rules).toHaveLength(1);
  expect(rules?.[0].source).toBe("/:path*");
  const headers = Object.fromEntries(rules?.[0].headers.map(({ key, value }) => [key, value]) ?? []);
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(headers["Referrer-Policy"]).toBe("no-referrer");
  expect(headers["X-Frame-Options"]).toBe("DENY");
  expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
  expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
});
