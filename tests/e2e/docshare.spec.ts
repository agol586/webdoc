import { expect, test } from "@playwright/test";
import { rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixtureReadme = resolve("tests/fixtures/project-alpha/README.md");
const unavailable = resolve("tests/fixtures/project-unavailable");
const hiddenUnavailable = resolve("tests/fixtures/.project-unavailable-hidden");
const oversized = resolve("tests/fixtures/project-alpha/oversized.md");

test("sends security headers on application and API responses", async ({ request }) => {
  for (const path of ["/p/project-alpha/README.md", "/api/projects"]) {
    const response = await request.get(path);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    const policy = response.headers()["content-security-policy"];
    const scripts = policy.split("; ").find((directive) => directive.startsWith("script-src "));
    expect(scripts).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  }
});

test("browses two projects and restores a deep link", async ({ page }) => {
  await page.goto("/p/project-alpha/guide/links.md");
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
  await page.getByLabel("Project").selectOption("project-beta");
  await expect(page).toHaveURL(/\/p\/project-beta\/index\.md$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
});

test("renders image, Mermaid, sanitization, external links, and live updates", async ({ page }) => {
  const original = await (await import("node:fs/promises")).readFile(fixtureReadme, "utf8");
  try {
    await page.goto("/p/project-alpha/README.md");
    await expect(page.getByRole("img", { name: "Diagram" })).toBeVisible();
    await expect(page.locator(".mermaid-viewport > svg")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(2);
    const firstDiagram = page.locator(".mermaid-diagram").first();
    const diagramSvg = firstDiagram.locator(".mermaid-viewport > svg");
    const originalViewBox = await diagramSvg.getAttribute("viewBox");
    await firstDiagram.getByRole("button", { name: "Zoom in" }).click();
    await expect(diagramSvg).not.toHaveAttribute("viewBox", originalViewBox!);
    await firstDiagram.getByRole("button", { name: "Reset view" }).click();
    await expect(diagramSvg).toHaveAttribute("viewBox", originalViewBox!);
    await expect(page.locator("script[data-secret='raw-html']")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "External documentation" })).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: "External documentation" })).toHaveAttribute("rel", "noopener noreferrer");
    await writeFile(fixtureReadme, original.replace("# Alpha", "# Changed heading"));
    await expect(page.getByRole("heading", { name: "Changed heading" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await writeFile(fixtureReadme, original);
  }
});

test("opens the document tree in a mobile drawer", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile project only");
  await page.goto("/p/project-alpha/README.md");
  await page.getByRole("button", { name: "Browse documents" }).click();
  await expect(page.locator(".mobile-tree")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
});

test("reports degraded live refresh without exposing implementation details", async ({ page }) => {
  await page.route("**/api/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"kind":"status","status":"degraded"}\n\n',
    });
  });
  await page.goto("/p/project-alpha/README.md");
  await expect(page.getByRole("status")).toHaveText("Live refresh disconnected");
  expect(await page.getByRole("status").textContent()).not.toContain(process.cwd());
});

test("shows safe missing, unavailable, and oversized failures", async ({ page }) => {
  const missing = await page.goto("/p/project-alpha/missing.md");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  expect(await page.textContent("body")).not.toContain(process.cwd());

  await writeFile(oversized, `# Oversized\n\n${"x".repeat(1500)}`);
  try {
    await page.goto("/p/project-alpha/oversized.md");
    await expect(page.getByRole("heading", { name: /could not be displayed/i })).toBeVisible();
    expect(await page.textContent("body")).not.toContain(oversized);
  } finally {
    await (await import("node:fs/promises")).unlink(oversized).catch(() => undefined);
  }

  await stat(unavailable);
  await rename(unavailable, hiddenUnavailable);
  try {
    const response = await page.goto("/p/unavailable/index.md");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Unavailable is unavailable" })).toBeVisible();
    expect(await page.textContent("body")).not.toContain(hiddenUnavailable);
  } finally {
    await rename(hiddenUnavailable, unavailable);
  }

});

test("HTTP normalization does not expose content for encoded dot segments", async ({ request }) => {
  // Next/WHATWG URL normalization prevents dot segments from reaching the route. The route-level
  // integration test passes ["..", "secret.md"] directly and asserts the path policy's exact 400.
  const response = await request.get("/api/content/project-alpha/%252e%252e%252fREADME.md");
  const body = await response.text();
  expect(response.status()).toBe(404);
  expect(JSON.parse(body)).toEqual({ error: "Not found" });
  expect(body).not.toContain(process.cwd());
});
