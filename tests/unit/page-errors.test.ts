import { describe, expect, it } from "vitest";

import { isMissingDocumentError } from "../../src/lib/page-errors";
import { PathPolicyError } from "../../src/lib/path-policy";
import { FileTooLargeError } from "../../src/repository/repository";

describe("document page error classification", () => {
  it.each(["ENOENT", "ENOTDIR"])("classifies %s as missing content", (code) => {
    expect(isMissingDocumentError(Object.assign(new Error("missing"), { code }))).toBe(true);
  });

  it.each([
    Object.assign(new Error("unreadable"), { code: "EACCES" }),
    new FileTooLargeError("large.md", 10, 1),
    new PathPolicyError("unsafe"),
    new Error("renderer failed"),
  ])("does not classify operational or internal errors as missing", (error) => {
    expect(isMissingDocumentError(error)).toBe(false);
  });
});
