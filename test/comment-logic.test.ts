import { describe, it, expect } from "bun:test";
import {
  updateCommentBody,
  type CommentUpdateInput,
} from "../src/github/operations/comment-logic";

describe("updateCommentBody", () => {
  const baseInput = {
    currentBody: "Initial comment body",
    actionFailed: false,
    executionDetails: null,
    jobUrl: "https://github.com/owner/repo/actions/runs/123",
    branchName: undefined,
    triggerUsername: undefined,
  };

  describe("working message replacement", () => {
    it("includes success message header with duration", () => {
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working…",
        executionDetails: { duration_ms: 74000 }, // 1m 14s
        triggerUsername: "trigger-user",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "**Letta Code finished @trigger-user's task in 1m 14s**",
      );
      expect(result).not.toContain("Letta Code is working");
    });

    it("includes error message header with duration", () => {
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working...",
        actionFailed: true,
        executionDetails: { duration_ms: 45000 }, // 45s
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Letta Code encountered an error after 45s**");
    });

    it("includes error details when provided", () => {
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working...",
        actionFailed: true,
        executionDetails: { duration_ms: 45000 },
        errorDetails: "Failed to fetch issue data",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Letta Code encountered an error after 45s**");
      expect(result).toContain("[View job]");
      expect(result).toContain("```\nFailed to fetch issue data\n```");
      // Ensure error details come after the header/links
      const errorIndex = result.indexOf("```");
      const headerIndex = result.indexOf("**Letta Code encountered an error");
      expect(errorIndex).toBeGreaterThan(headerIndex);
    });

    it("handles username extraction from content when not provided", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Letta Code is working… <img src='spinner.gif' />\n\nI'll work on this task @testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Letta Code finished @testuser's task**");
    });
  });

  describe("job link", () => {
    it("includes job link in header", () => {
      const input = {
        ...baseInput,
        currentBody: "Some comment",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`—— [View job](${baseInput.jobUrl})`);
    });

    it("always includes job link in header, even if present in body", () => {
      const input = {
        ...baseInput,
        currentBody: `Some comment with [View job run](${baseInput.jobUrl})`,
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      // Check it's in the header with the new format
      expect(result).toContain(`—— [View job](${baseInput.jobUrl})`);
      // The old link in body is removed
      expect(result).not.toContain("View job run");
    });
  });

  describe("branch link", () => {
    it("adds branch name with link to header when provided", () => {
      const input = {
        ...baseInput,
        branchName: "letta/issue-123-20240101-1200",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`letta/issue-123-20240101-1200`](https://github.com/owner/repo/tree/letta/issue-123-20240101-1200)",
      );
    });

    it("extracts branch name from branchLink if branchName not provided", () => {
      const input = {
        ...baseInput,
        branchLink:
          "\n[View branch](https://github.com/owner/repo/tree/branch-name)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`branch-name`](https://github.com/owner/repo/tree/branch-name)",
      );
    });

    it("removes old branch links from body", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [View branch](https://github.com/owner/repo/tree/branch-name)",
        branchName: "new-branch-name",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`new-branch-name`](https://github.com/owner/repo/tree/new-branch-name)",
      );
      expect(result).not.toContain("View branch");
    });
  });

  describe("PR link", () => {
    it("adds PR link to header when provided", () => {
      const input = {
        ...baseInput,
        prLink: "\n[Create a PR](https://github.com/owner/repo/pr-url)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url)",
      );
    });

    it("moves PR link from body to header", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [Create a PR](https://github.com/owner/repo/pr-url)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url)",
      );
      // Original Create a PR link is removed from body
      expect(result).not.toContain("[Create a PR]");
    });

    it("handles both body and provided PR links", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [Create a PR](https://github.com/owner/repo/pr-url-from-body)",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/pr-url-provided)",
      };

      const result = updateCommentBody(input);
      // Prefers the link found in content over the provided one
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url-from-body)",
      );
    });

    it("handles complex PR URLs with encoded characters", () => {
      const complexUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20important%20bug%20fix&body=Fixes%20%23123%0A%0A%23%23%20Description%0AThis%20PR%20fixes%20an%20important%20bug%20that%20was%20causing%20issues%20with%20the%20application.%0A%0AGenerated%20with%20%5BLetta%20Code%5D(https%3A%2F%2Fletta.com)";
      // After re-encoding, parentheses in body param should be encoded as %28/%29
      const expectedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20important%20bug%20fix&body=Fixes%20%23123%0A%0A%23%23%20Description%0AThis%20PR%20fixes%20an%20important%20bug%20that%20was%20causing%20issues%20with%20the%20application.%0A%0AGenerated%20with%20%5BLetta%20Code%5D%28https%3A%2F%2Fletta.com%29";
      const input = {
        ...baseInput,
        currentBody: `Some comment with [Create a PR](${complexUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${expectedUrl})`);
      // Original link should be removed from body
      expect(result).not.toContain("[Create a PR]");
    });

    it("handles PR links with encoded URLs containing parentheses", () => {
      const complexUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20bug%20fix&body=Generated%20with%20%5BLetta%20Code%5D(https%3A%2F%2Fletta.com)";
      // After re-encoding, parentheses in body param should be encoded as %28/%29
      const expectedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20bug%20fix&body=Generated%20with%20%5BLetta%20Code%5D%28https%3A%2F%2Fletta.com%29";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${complexUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${expectedUrl})`);
      // Original link should be removed from body completely
      expect(result).not.toContain("[Create a PR]");
      // Body content shouldn't have stray closing parens
      expect(result).toContain("This PR was created.");
      // Body part should be clean with no stray parens
      const bodyAfterSeparator = result.split("---")[1]?.trim();
      expect(bodyAfterSeparator).toBe("This PR was created.");
    });

    it("handles PR links with unencoded spaces and special characters", () => {
      const unEncodedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix: update welcome message&body=Generated with [Letta Code](https://letta.com)";
      // After encoding: spaces become %20, colons %3A, brackets %5B/%5D, parentheses %28/%29
      const expectedEncodedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20update%20welcome%20message&body=Generated%20with%20%5BLetta%20Code%5D%28https%3A%2F%2Fletta.com%29";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${unEncodedUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${expectedEncodedUrl})`);
      // Original link should be removed from body completely
      expect(result).not.toContain("[Create a PR]");
      // Body content should be preserved
      expect(result).toContain("This PR was created.");
    });

    it("falls back to prLink parameter when PR link in content cannot be encoded", () => {
      const invalidUrl = "not-a-valid-url-at-all";
      const fallbackPrUrl = "https://github.com/owner/repo/pull/123";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${invalidUrl})`,
        prLink: `\n[Create a PR](${fallbackPrUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${fallbackPrUrl})`);
      // Original link with invalid URL should still be in body since encoding failed
      expect(result).toContain("[Create a PR](not-a-valid-url-at-all)");
      expect(result).toContain("This PR was created.");
    });
  });

  describe("execution details", () => {
    it("includes duration in header for success", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          total_cost_usd: 0.13382595,
          duration_ms: 31033,
          duration_api_ms: 31034,
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "**Letta Code finished @testuser's task in 31s**",
      );
    });

    it("formats duration in minutes and seconds in header", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          duration_ms: 75000, // 1 minute 15 seconds
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "**Letta Code finished @testuser's task in 1m 15s**",
      );
    });

    it("includes duration in error header", () => {
      const input = {
        ...baseInput,
        actionFailed: true,
        executionDetails: {
          duration_ms: 45000, // 45 seconds
        },
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Letta Code encountered an error after 45s**");
    });

    it("handles missing duration gracefully", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          total_cost_usd: 0.25,
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Letta Code finished @testuser's task**");
      expect(result).not.toContain(" in ");
    });
  });

  describe("combined updates", () => {
    it("combines all updates in correct order", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Letta Code is working…\n\n### Todo List:\n- [x] Read README.md\n- [x] Add disclaimer",
        actionFailed: false,
        branchName: "letta-branch-123",
        prLink: "\n[Create a PR](https://github.com/owner/repo/pr-url)",
        executionDetails: {
          total_cost_usd: 0.01,
          duration_ms: 65000, // 1 minute 5 seconds
        },
        triggerUsername: "trigger-user",
      };

      const result = updateCommentBody(input);

      // Check the header structure
      expect(result).toContain(
        "**Letta Code finished @trigger-user's task in 1m 5s**",
      );
      expect(result).toContain("—— [View job]");
      expect(result).toContain(
        "• [`letta-branch-123`](https://github.com/owner/repo/tree/letta-branch-123)",
      );
      expect(result).toContain("• [Create PR ➔]");

      // Check order - header comes before separator with blank line
      const headerIndex = result.indexOf("**Letta Code finished");
      const blankLineAndSeparatorPattern = /\n\n---\n/;
      expect(result).toMatch(blankLineAndSeparatorPattern);

      const separatorIndex = result.indexOf("---");
      const todoIndex = result.indexOf("### Todo List:");

      expect(headerIndex).toBeLessThan(separatorIndex);
      expect(separatorIndex).toBeLessThan(todoIndex);

      // Check content is preserved
      expect(result).toContain("### Todo List:");
      expect(result).toContain("- [x] Read README.md");
      expect(result).toContain("- [x] Add disclaimer");
    });

    it("handles PR link extraction from content", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Letta Code is working…\n\nI've made changes.\n[Create a PR](https://github.com/owner/repo/pr-url-in-content)\n\n@john-doe",
        branchName: "feature-branch",
        triggerUsername: "john-doe",
      };

      const result = updateCommentBody(input);

      // PR link should be moved to header
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url-in-content)",
      );
      // Original link should be removed from body
      expect(result).not.toContain("[Create a PR]");
      // Username should come from argument, not extraction
      expect(result).toContain("**Letta Code finished @john-doe's task**");
      // Content should be preserved
      expect(result).toContain("I've made changes.");
    });

    it("includes PR link for new branches (issues and closed PRs)", () => {
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working… <img src='spinner.gif' />",
        branchName: "letta/pr-456-20240101-1200",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/compare/main...letta/pr-456-20240101-1200)",
        triggerUsername: "jane-doe",
      };

      const result = updateCommentBody(input);

      // Should include the PR link in the formatted style
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/compare/main...letta/pr-456-20240101-1200)",
      );
      expect(result).toContain("**Letta Code finished @jane-doe's task**");
    });

    it("includes both branch link and PR link for new branches", () => {
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working…",
        branchName: "letta/issue-123-20240101-1200",
        branchLink:
          "\n[View branch](https://github.com/owner/repo/tree/letta/issue-123-20240101-1200)",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/compare/main...letta/issue-123-20240101-1200)",
      };

      const result = updateCommentBody(input);

      // Should include both links in formatted style
      expect(result).toContain(
        "• [`letta/issue-123-20240101-1200`](https://github.com/owner/repo/tree/letta/issue-123-20240101-1200)",
      );
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/compare/main...letta/issue-123-20240101-1200)",
      );
    });

    it("encodes parentheses in prLink parameter (encodeURIComponent does not encode parens)", () => {
      // This reproduces the actual bug: encodeURIComponent("...](https://letta.com)")
      // leaves literal ( and ) which break markdown link syntax [text](url)
      const body = encodeURIComponent(
        "This PR addresses issue #25\n\nGenerated with [Letta Code](https://letta.com)",
      );
      const prUrl = `https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=Issue%20%2325%3A%20Changes%20from%20Letta&body=${body}`;
      const input = {
        ...baseInput,
        currentBody: "Letta Code is working…",
        prLink: `\n[Create a PR](${prUrl})`,
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);

      // The URL in the final markdown must have %28/%29 for parentheses
      expect(result).toContain("%28https%3A%2F%2Fletta.com%29");
      // Must NOT contain literal unencoded parentheses inside the URL query params
      expect(result).not.toContain(
        "%5BLetta%20Code%5D(https%3A%2F%2Fletta.com)",
      );
      expect(result).toContain("• [Create PR ➔](");
    });

    it("unencoded parens in prLink don't break body content or separator", () => {
      // Reproduces the real-world bug: unencoded () in the URL caused the markdown
      // link to never close, consuming the --- separator, body content, and footer
      const body = encodeURIComponent(
        "This PR addresses issue #25\n\nGenerated with [Letta Code](https://letta.com)",
      );
      const prUrl = `https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=Issue%20%2325%3A%20Changes%20from%20Letta&body=${body}`;
      const input: CommentUpdateInput = {
        currentBody:
          "Letta Code is working…\n\n### Tasks\n- [x] Explore codebase\n- [x] Write tests\n- [x] Commit and push",
        actionFailed: false,
        executionDetails: { duration_ms: 120000 },
        jobUrl: "https://github.com/owner/repo/actions/runs/123",
        branchName: "letta/issue-25-20260223",
        prLink: `\n[Create a PR](${prUrl})`,
        triggerUsername: "sarahwooders",
      };

      const result = updateCommentBody(input);

      // Header must be on its own line, terminated before separator
      expect(result).toContain(
        "**Letta Code finished @sarahwooders's task in 2m 0s**",
      );

      // Separator must exist between header and body
      expect(result).toMatch(/\[Create PR ➔\]\([^)]+\)\n\n---\n/);

      // Body content must be preserved with formatting intact
      expect(result).toContain("### Tasks");
      expect(result).toContain("- [x] Explore codebase");
      expect(result).toContain("- [x] Write tests");
      expect(result).toContain("- [x] Commit and push");

      // The Create PR URL must have properly encoded parentheses
      expect(result).toContain("%28https%3A%2F%2Fletta.com%29");
    });

    it("unencoded parens in prLink don't swallow agent footer", () => {
      const body = encodeURIComponent(
        "Fixes #10\n\nGenerated with [Letta Code](https://letta.com)",
      );
      const prUrl = `https://github.com/owner/repo/compare/main...branch?quick_pull=1&title=Fix&body=${body}`;
      const input: CommentUpdateInput = {
        currentBody: "Letta Code is working…\n\nDone!",
        actionFailed: false,
        executionDetails: { duration_ms: 30000 },
        jobUrl: "https://github.com/owner/repo/actions/runs/456",
        prLink: `\n[Create a PR](${prUrl})`,
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        agentName: "Test Agent",
        conversationId: "conv-xyz789",
      };

      const result = updateCommentBody(input);

      // Agent footer must be present
      expect(result).toContain("🤖 **Agent:**");
      expect(result).toContain("[Test Agent]");
      expect(result).toContain("app.letta.com/agents/agent-abc123");
      expect(result).toContain("conv-xyz789");
      expect(result).toContain("💻 Chat with this agent");
      expect(result).toContain("letta --conv conv-xyz789");

      // Body content must still be there
      expect(result).toContain("Done!");
    });

    it("should not show branch name when branch doesn't exist remotely", () => {
      const input: CommentUpdateInput = {
        currentBody: "@letta-code can you help with this?",
        actionFailed: false,
        executionDetails: { duration_ms: 90000 },
        jobUrl: "https://github.com/owner/repo/actions/runs/123",
        branchLink: "", // Empty branch link means branch doesn't exist remotely
        branchName: undefined, // Should be undefined when branchLink is empty
        triggerUsername: "letta-code",
        prLink: "",
      };

      const result = updateCommentBody(input);

      expect(result).toContain(
        "Letta Code finished @letta-code's task in 1m 30s",
      );
      expect(result).toContain(
        "[View job](https://github.com/owner/repo/actions/runs/123)",
      );
      expect(result).not.toContain("letta/issue-123");
      expect(result).not.toContain("tree/letta/issue-123");
    });
  });

  describe("agent footer", () => {
    it("adds agent footer with name and ADE link when agentId provided", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        agentName: "My Agent",
      };

      const result = updateCommentBody(input);

      expect(result).toContain(
        "🤖 **Agent:** [My Agent](https://app.letta.com/agents/agent-abc123)",
      );
      expect(result).toContain("[View job run]");
    });

    it("uses agentId as display name when agentName not provided", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
      };

      const result = updateCommentBody(input);

      expect(result).toContain(
        "🤖 **Agent:** [agent-abc123](https://app.letta.com/agents/agent-abc123)",
      );
    });

    it("includes conversation param in ADE URL when conversationId provided", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        agentName: "My Agent",
        conversationId: "conv-xyz789",
      };

      const result = updateCommentBody(input);

      expect(result).toContain(
        "https://app.letta.com/agents/agent-abc123?conversation=conv-xyz789",
      );
    });

    it("includes CLI command with --conv when conversationId provided", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        conversationId: "conv-xyz789",
      };

      const result = updateCommentBody(input);

      expect(result).toContain(
        "💻 Chat with this agent in your terminal using [Letta Code]",
      );
      expect(result).toContain("`letta --conv conv-xyz789`");
    });

    it("includes CLI command with --agent when no conversationId", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
      };

      const result = updateCommentBody(input);

      expect(result).toContain("`letta --agent agent-abc123`");
    });

    it("does not add footer when agentId is empty", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "",
      };

      const result = updateCommentBody(input);

      expect(result).not.toContain("🤖 **Agent:**");
      expect(result).not.toContain("💻 Chat with this agent");
    });

    it("includes letta-metadata comment when agentId provided", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Task completed.",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        conversationId: "conv-xyz789",
        model: "claude-opus-4-6",
      };

      const result = updateCommentBody(input);

      expect(result).toContain("<!-- letta-metadata");
      expect(result).toContain("agent_id: agent-abc123");
      expect(result).toContain("conversation_id: conv-xyz789");
      expect(result).toContain("model: claude-opus-4-6");
    });

    it("strips existing footer from body before rebuilding", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody:
          "I made the changes.\n\n---\n🤖 **Agent:** [Old Agent](https://app.letta.com/agents/agent-old) • [View job run](https://github.com/old/url)\n💻 Chat with this agent in your terminal using [Letta Code](https://github.com/letta-ai/letta-code): `letta --agent agent-old`",
        triggerUsername: "testuser",
        agentId: "agent-new456",
        agentName: "New Agent",
      };

      const result = updateCommentBody(input);

      // Old footer should be stripped
      expect(result).not.toContain("Old Agent");
      expect(result).not.toContain("agent-old");

      // New footer should be present
      expect(result).toContain("[New Agent]");
      expect(result).toContain("agent-new456");

      // Body content should be preserved
      expect(result).toContain("I made the changes.");
    });

    it("footer appears after body content with separator", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody:
          "### Todo\n- [x] Task 1\n- [x] Task 2\n\nAll done!",
        triggerUsername: "testuser",
        agentId: "agent-abc123",
        agentName: "My Agent",
      };

      const result = updateCommentBody(input);

      // Verify order: header → separator → body → separator → footer
      const headerIdx = result.indexOf("**Letta Code finished");
      const bodyIdx = result.indexOf("### Todo");
      const footerIdx = result.indexOf("🤖 **Agent:**");

      expect(headerIdx).toBeLessThan(bodyIdx);
      expect(bodyIdx).toBeLessThan(footerIdx);

      // Footer should have its own --- separator
      const footerSection = result.slice(bodyIdx);
      expect(footerSection).toContain("---\n🤖 **Agent:**");
    });
  });

  describe("realistic end-to-end scenarios", () => {
    it("reproduces the exact bug from issue #25 (unencoded parens break entire comment)", () => {
      // This is the exact scenario from the lettabot-private repo:
      // The agent wrote todo items, action constructed prLink with encodeURIComponent,
      // and the old regex [^)]+ truncated the URL, leaving the markdown link unclosed.
      const body = encodeURIComponent(
        "This PR addresses issue #25\n\nGenerated with [Letta Code](https://letta.com)",
      );
      const prUrl = `https://github.com/letta-ai/lettabot-private/compare/main...letta/issue-25-20260223-0728?quick_pull=1&title=Issue%20%2325%3A%20Changes%20from%20Letta&body=${body}`;

      const input: CommentUpdateInput = {
        currentBody:
          "Letta Code is working…\n\nI'll analyze this and get back to you.\n\n[View job run](https://github.com/letta-ai/lettabot-private/actions/runs/123)\n[View branch](https://github.com/letta-ai/lettabot-private/tree/letta/issue-25-20260223-0728)\n\nAdded a comprehensive test suite with **105 tests** across 7 test files, all passing.\n\n### Tasks\n- [x] Explore codebase and identify testable modules\n- [x] Set up test framework (vitest)\n- [x] Write tests for core/formatter (18 tests)\n- [x] Verify all 105 tests pass\n- [x] Commit, push, and create PR\n\n---\n🤖 **Agent:** [GitHub Action Agent](https://app.letta.com/agents/agent-127a) • [View job run](https://github.com/letta-ai/lettabot-private/actions/runs/123)\n💻 Chat with this agent in your terminal using [Letta Code](https://github.com/letta-ai/letta-code): `letta --conv conv-9ca3`\n\n<!-- letta-metadata\nagent_id: agent-127a\nconversation_id: conv-9ca3\nmodel: claude-opus-4-6\n-->",
        actionFailed: false,
        executionDetails: { duration_ms: 300000 },
        jobUrl:
          "https://github.com/letta-ai/lettabot-private/actions/runs/456",
        branchName: "letta/issue-25-20260223-0728",
        branchLink:
          "\n[View branch](https://github.com/letta-ai/lettabot-private/tree/letta/issue-25-20260223-0728)",
        prLink: `\n[Create a PR](${prUrl})`,
        triggerUsername: "sarahwooders",
        agentId: "agent-127a9d55",
        agentName: "GitHub Action Agent",
        conversationId: "conv-9ca3529d",
        model: "claude-opus-4-6",
      };

      const result = updateCommentBody(input);

      // 1. Header must be correct
      expect(result).toContain(
        "**Letta Code finished @sarahwooders's task in 5m 0s**",
      );

      // 2. Links in header must all be present and properly terminated
      expect(result).toContain("—— [View job]");
      expect(result).toContain("• [`letta/issue-25-20260223-0728`]");
      expect(result).toContain("• [Create PR ➔]");

      // 3. Body content must be preserved (not consumed by broken URL)
      expect(result).toContain("### Tasks");
      expect(result).toContain("- [x] Explore codebase and identify testable modules");
      expect(result).toContain("- [x] Verify all 105 tests pass");
      expect(result).toContain("Added a comprehensive test suite");

      // 4. Agent footer must be present (not consumed by broken URL)
      expect(result).toContain("🤖 **Agent:** [GitHub Action Agent]");
      expect(result).toContain("agent-127a9d55");
      expect(result).toContain("💻 Chat with this agent");
      expect(result).toContain("`letta --conv conv-9ca3529d`");

      // 5. Old footer must be stripped (not duplicated)
      // The old footer had "agent-127a" as a short ID and "Old Agent" display
      // but those get stripped by the footer regex. The new footer uses the new agent ID.
      expect(result).not.toContain("[GitHub Action Agent](https://app.letta.com/agents/agent-127a)");
      expect(result).toContain("agent-127a9d55");

      // 6. Old metadata must be stripped
      const metadataCount = (
        result.match(/<!-- letta-metadata/g) || []
      ).length;
      expect(metadataCount).toBe(1);

      // 7. Old View job run / View branch links must be stripped from body
      const bodySection = result.split("---")[1] || "";
      expect(bodySection).not.toContain("[View job run]");
      expect(bodySection).not.toContain("[View branch]");

      // 8. The Create PR URL must have encoded parentheses
      expect(result).toContain("%28https%3A%2F%2Fletta.com%29");
      expect(result).not.toContain(
        "%5BLetta%20Code%5D(https%3A%2F%2Fletta.com)",
      );
    });
  });
});
