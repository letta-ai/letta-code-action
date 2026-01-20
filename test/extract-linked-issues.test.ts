import { describe, expect, test } from "bun:test";
import { extractLinkedIssues } from "../src/letta/find-existing-agent";

describe("extractLinkedIssues", () => {
  test("should extract issue from 'Fixes #123'", () => {
    expect(extractLinkedIssues("Fixes #123")).toEqual([123]);
  });

  test("should extract issue from 'fixes #123' (lowercase)", () => {
    expect(extractLinkedIssues("fixes #123")).toEqual([123]);
  });

  test("should extract issue from 'Closes #456'", () => {
    expect(extractLinkedIssues("Closes #456")).toEqual([456]);
  });

  test("should extract issue from 'Resolves #789'", () => {
    expect(extractLinkedIssues("Resolves #789")).toEqual([789]);
  });

  test("should extract issue from 'Fixed #123'", () => {
    expect(extractLinkedIssues("Fixed #123")).toEqual([123]);
  });

  test("should extract issue from 'Closed #123'", () => {
    expect(extractLinkedIssues("Closed #123")).toEqual([123]);
  });

  test("should extract issue from 'Resolved #123'", () => {
    expect(extractLinkedIssues("Resolved #123")).toEqual([123]);
  });

  test("should handle colon syntax 'Fixes: #123'", () => {
    expect(extractLinkedIssues("Fixes: #123")).toEqual([123]);
  });

  test("should extract multiple issues", () => {
    const body = "Fixes #123 and also Closes #456";
    const result = extractLinkedIssues(body);
    expect(result).toContain(123);
    expect(result).toContain(456);
    expect(result.length).toBe(2);
  });

  test("should deduplicate repeated issue references", () => {
    const body = "Fixes #123, also fixes #123 again";
    expect(extractLinkedIssues(body)).toEqual([123]);
  });

  test("should handle PR body with other content", () => {
    const body = `## Summary
This PR adds a new feature.

Fixes #42

## Test Plan
- Test manually`;
    expect(extractLinkedIssues(body)).toEqual([42]);
  });

  test("should return empty array for null body", () => {
    expect(extractLinkedIssues(null)).toEqual([]);
  });

  test("should return empty array for undefined body", () => {
    expect(extractLinkedIssues(undefined)).toEqual([]);
  });

  test("should return empty array for body without linked issues", () => {
    expect(extractLinkedIssues("Just a regular PR description")).toEqual([]);
  });

  test("should not match issue references without keywords", () => {
    expect(extractLinkedIssues("See #123 for details")).toEqual([]);
  });

  test("should not match partial word matches", () => {
    // "prefix" contains "fix" but shouldn't match
    expect(extractLinkedIssues("prefix #123")).toEqual([]);
  });
});
