import { expect, describe, it } from "bun:test";
import { ensureProperlyEncodedUrl } from "../src/github/operations/comment-logic";

describe("ensureProperlyEncodedUrl", () => {
  it("should handle URLs with spaces", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix: update message&body=Description here";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20update%20message&body=Description%20here";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should handle URLs with unencoded colons", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix: update message";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20update%20message";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should handle URLs that are already properly encoded", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20update%20message&body=Description%20here";
    expect(ensureProperlyEncodedUrl(url)).toBe(url);
  });

  it("should handle URLs with partially encoded content", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A update message&body=Description here";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20update%20message&body=Description%20here";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should handle URLs with special characters including parentheses", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=feat(scope): add new feature!&body=Generated with [Letta Code](https://letta.com)";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=feat%28scope%29%3A%20add%20new%20feature%21&body=Generated%20with%20%5BLetta%20Code%5D%28https%3A%2F%2Fletta.com%29";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should not encode the base URL", () => {
    const url =
      "https://github.com/owner/repo/compare/main...feature/new-branch?quick_pull=1&title=fix: test";
    const expected =
      "https://github.com/owner/repo/compare/main...feature/new-branch?quick_pull=1&title=fix%3A%20test";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should handle malformed URLs gracefully", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix: test&body=";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20test&body=";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should handle URLs with line breaks in parameters", () => {
    const url =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix: test&body=Line 1\nLine 2";
    const expected =
      "https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=fix%3A%20test&body=Line%201%0ALine%202";
    expect(ensureProperlyEncodedUrl(url)).toBe(expected);
  });

  it("should return null for completely invalid URLs", () => {
    const url = "not-a-url-at-all";
    expect(ensureProperlyEncodedUrl(url)).toBe(null);
  });

  it("should handle URLs with severe malformation", () => {
    const url = "https://[invalid:url:format]/path";
    expect(ensureProperlyEncodedUrl(url)).toBe(null);
  });
});
