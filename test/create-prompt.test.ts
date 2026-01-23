#!/usr/bin/env bun

import { describe, test, expect } from "bun:test";
import {
  generatePrompt,
  generateDefaultPrompt,
  getEventTypeAndContext,
  buildAllowedToolsString,
  buildDisallowedToolsString,
} from "../src/create-prompt";
import type { PreparedContext } from "../src/create-prompt";
import type { Mode } from "../src/modes/types";

describe("generatePrompt", () => {
  // Create a mock tag mode that uses the default prompt
  const mockTagMode: Mode = {
    name: "tag",
    description: "Tag mode",
    shouldTrigger: () => true,
    prepareContext: (context) => ({ mode: "tag", githubContext: context }),
    getAllowedTools: () => [],
    getDisallowedTools: () => [],
    shouldCreateTrackingComment: () => true,
    generatePrompt: (context, githubData, useCommitSigning) =>
      generateDefaultPrompt(context, githubData, useCommitSigning),
    prepare: async () => ({
      commentId: 123,
      branchInfo: {
        baseBranch: "main",
        currentBranch: "main",
        lettaBranch: undefined,
      },
    }),
  };

  // Create a mock agent mode that passes through prompts
  const mockAgentMode: Mode = {
    name: "agent",
    description: "Agent mode",
    shouldTrigger: () => true,
    prepareContext: (context) => ({ mode: "agent", githubContext: context }),
    getAllowedTools: () => [],
    getDisallowedTools: () => [],
    shouldCreateTrackingComment: () => false,
    generatePrompt: (context) => context.prompt || "",
    prepare: async () => ({
      commentId: undefined,
      branchInfo: {
        baseBranch: "main",
        currentBranch: "main",
        lettaBranch: undefined,
      },
    }),
  };

  const mockGitHubData = {
    contextData: {
      title: "Test PR",
      body: "This is a test PR",
      author: { login: "testuser" },
      state: "OPEN",
      createdAt: "2023-01-01T00:00:00Z",
      additions: 15,
      deletions: 5,
      baseRefName: "main",
      headRefName: "feature-branch",
      headRefOid: "abc123",
      commits: {
        totalCount: 2,
        nodes: [
          {
            commit: {
              oid: "commit1",
              message: "Add feature",
              author: {
                name: "John Doe",
                email: "john@example.com",
              },
            },
          },
        ],
      },
      files: {
        nodes: [
          {
            path: "src/file1.ts",
            additions: 10,
            deletions: 5,
            changeType: "MODIFIED",
          },
        ],
      },
      comments: {
        nodes: [
          {
            id: "comment1",
            databaseId: "123456",
            body: "First comment",
            author: { login: "user1" },
            createdAt: "2023-01-01T01:00:00Z",
          },
        ],
      },
      reviews: {
        nodes: [
          {
            id: "review1",
            author: { login: "reviewer1" },
            body: "LGTM",
            state: "APPROVED",
            submittedAt: "2023-01-01T02:00:00Z",
            comments: {
              nodes: [],
            },
          },
        ],
      },
    },
    comments: [
      {
        id: "comment1",
        databaseId: "123456",
        body: "First comment",
        author: { login: "user1" },
        createdAt: "2023-01-01T01:00:00Z",
      },
      {
        id: "comment2",
        databaseId: "123457",
        body: "@letta-code help me",
        author: { login: "user2" },
        createdAt: "2023-01-01T01:30:00Z",
      },
    ],
    changedFiles: [],
    changedFilesWithSHA: [
      {
        path: "src/file1.ts",
        additions: 10,
        deletions: 5,
        changeType: "MODIFIED",
        sha: "abc123",
      },
    ],
    reviewData: {
      nodes: [
        {
          id: "review1",
          databaseId: "400001",
          author: { login: "reviewer1" },
          body: "LGTM",
          state: "APPROVED",
          submittedAt: "2023-01-01T02:00:00Z",
          comments: {
            nodes: [],
          },
        },
      ],
    },
    imageUrlMap: new Map<string, string>(),
  };

  test("should generate prompt for issue_comment event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: false,
        baseBranch: "main",
        lettaBranch: "letta/issue-67890-20240101-1200",
        issueNumber: "67890",
        commentBody: "@letta-code please fix this",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("Here's the context for your current task:");
    expect(prompt).toContain("<event_type>GENERAL_COMMENT</event_type>");
    expect(prompt).toContain("<is_pr>false</is_pr>");
    expect(prompt).toContain(
      "<trigger_context>issue comment with '@letta-code'</trigger_context>",
    );
    expect(prompt).toContain("<repository>owner/repo</repository>");
    expect(prompt).toContain("<letta_comment_id>12345</letta_comment_id>");
    expect(prompt).toContain("<trigger_username>Unknown</trigger_username>");
    expect(prompt).toContain("[user1 at 2023-01-01T01:00:00Z]: First comment"); // from formatted comments
    expect(prompt).not.toContain("filename\tstatus\tadditions\tdeletions\tsha"); // since it's not a PR
  });

  test("should generate prompt for pull_request_review event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request_review",
        isPR: true,
        prNumber: "456",
        commentBody: "@letta-code please fix this bug",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<event_type>PR_REVIEW</event_type>");
    expect(prompt).toContain("<is_pr>true</is_pr>");
    expect(prompt).toContain("<pr_number>456</pr_number>");
    expect(prompt).toContain("- src/file1.ts (MODIFIED) +10/-5 SHA: abc123"); // from formatted changed files
    expect(prompt).toContain(
      "[Review by reviewer1 at 2023-01-01T02:00:00Z]: APPROVED",
    ); // from review comments
  });

  test("should generate prompt for issue opened event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "opened",
        isPR: false,
        issueNumber: "789",
        baseBranch: "main",
        lettaBranch: "letta/issue-789-20240101-1200",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<event_type>ISSUE_CREATED</event_type>");
    expect(prompt).toContain(
      "<trigger_context>new issue with '@letta-code' in body</trigger_context>",
    );
    expect(prompt).toContain("gh pr create");
  });

  test("should generate prompt for issue assigned event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "assigned",
        isPR: false,
        issueNumber: "999",
        baseBranch: "develop",
        lettaBranch: "letta/issue-999-20240101-1200",
        assigneeTrigger: "letta-bot",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<event_type>ISSUE_ASSIGNED</event_type>");
    expect(prompt).toContain(
      "<trigger_context>issue assigned to 'letta-bot'</trigger_context>",
    );
    expect(prompt).toContain("gh pr create");
  });

  test("should generate prompt for issue labeled event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "labeled",
        isPR: false,
        issueNumber: "888",
        baseBranch: "main",
        lettaBranch: "letta/issue-888-20240101-1200",
        labelTrigger: "letta-task",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<event_type>ISSUE_LABELED</event_type>");
    expect(prompt).toContain(
      "<trigger_context>issue labeled with 'letta-task'</trigger_context>",
    );
    expect(prompt).toContain("gh pr create");
  });

  // Removed test - direct_prompt field no longer supported in v1.0

  test("should generate prompt for pull_request event", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request",
        eventAction: "opened",
        isPR: true,
        prNumber: "999",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<event_type>PULL_REQUEST</event_type>");
    expect(prompt).toContain("<is_pr>true</is_pr>");
    expect(prompt).toContain("<pr_number>999</pr_number>");
    expect(prompt).toContain("pull request opened");
  });

  test("should generate prompt for issue comment without custom fields", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: false,
        issueNumber: "123",
        baseBranch: "main",
        lettaBranch: "letta/issue-67890-20240101-1200",
        commentBody: "@letta-code please fix this",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Verify prompt generates successfully without custom instructions
    expect(prompt).toContain("@letta-code please fix this");
    expect(prompt).not.toContain("CUSTOM INSTRUCTIONS");
  });

  test("should use override_prompt when provided", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      prompt: "Simple prompt for reviewing PR",
      eventData: {
        eventName: "pull_request",
        eventAction: "opened",
        isPR: true,
        prNumber: "123",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockAgentMode,
    );

    // Agent mode: Prompt is passed through as-is
    expect(prompt).toBe("Simple prompt for reviewing PR");
    expect(prompt).not.toContain("Here's the context for your current task:");
  });

  test("should pass through prompt without variable substitution", async () => {
    const envVars: PreparedContext = {
      repository: "test/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      triggerUsername: "john-doe",
      prompt: `Repository: $REPOSITORY
      PR: $PR_NUMBER
      Title: $PR_TITLE
      Body: $PR_BODY
      Comments: $PR_COMMENTS
      Review Comments: $REVIEW_COMMENTS
      Changed Files: $CHANGED_FILES
      Trigger Comment: $TRIGGER_COMMENT
      Username: $TRIGGER_USERNAME
      Branch: $BRANCH_NAME
      Base: $BASE_BRANCH
      Event: $EVENT_TYPE
      Is PR: $IS_PR`,
      eventData: {
        eventName: "pull_request_review_comment",
        isPR: true,
        prNumber: "456",
        commentBody: "Please review this code",
        lettaBranch: "feature-branch",
        baseBranch: "main",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockAgentMode,
    );

    // v1.0: Variables are NOT substituted - prompt is passed as-is to Letta Code
    expect(prompt).toContain("Repository: $REPOSITORY");
    expect(prompt).toContain("PR: $PR_NUMBER");
    expect(prompt).toContain("Title: $PR_TITLE");
    expect(prompt).toContain("Body: $PR_BODY");
    expect(prompt).toContain("Branch: $BRANCH_NAME");
    expect(prompt).toContain("Base: $BASE_BRANCH");
    expect(prompt).toContain("Username: $TRIGGER_USERNAME");
    expect(prompt).toContain("Comment: $TRIGGER_COMMENT");
  });

  test("should handle override_prompt for issues", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      prompt: "Review issue and provide feedback",
      eventData: {
        eventName: "issues",
        eventAction: "opened",
        isPR: false,
        issueNumber: "789",
        baseBranch: "main",
        lettaBranch: "letta/issue-789-20240101-1200",
      },
    };

    const issueGitHubData = {
      ...mockGitHubData,
      contextData: {
        title: "Bug: Login form broken",
        body: "The login form is not working",
        author: { login: "testuser" },
        state: "OPEN",
        createdAt: "2023-01-01T00:00:00Z",
        comments: {
          nodes: [],
        },
      },
    };

    const prompt = await generatePrompt(
      envVars,
      issueGitHubData,
      false,
      mockAgentMode,
    );

    // Agent mode: Prompt is passed through as-is
    expect(prompt).toBe("Review issue and provide feedback");
  });

  test("should handle prompt without substitution", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      prompt: "PR: $PR_NUMBER, Issue: $ISSUE_NUMBER, Comment: $TRIGGER_COMMENT",
      eventData: {
        eventName: "pull_request",
        eventAction: "opened",
        isPR: true,
        prNumber: "123",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockAgentMode,
    );

    // Agent mode: No substitution - passed as-is
    expect(prompt).toBe(
      "PR: $PR_NUMBER, Issue: $ISSUE_NUMBER, Comment: $TRIGGER_COMMENT",
    );
  });

  test("should not substitute variables when override_prompt is not provided", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "opened",
        isPR: false,
        issueNumber: "123",
        baseBranch: "main",
        lettaBranch: "letta/issue-123-20240101-1200",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("Here's the context for your current task:");
    expect(prompt).toContain("<event_type>ISSUE_CREATED</event_type>");
  });

  test("should include trigger username when provided", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      triggerUsername: "johndoe",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: false,
        issueNumber: "123",
        baseBranch: "main",
        lettaBranch: "letta/issue-67890-20240101-1200",
        commentBody: "@letta-code please fix this",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    expect(prompt).toContain("<trigger_username>johndoe</trigger_username>");
    // With commit signing disabled, co-author info appears in git commit instructions
    expect(prompt).toContain(
      "Co-authored-by: johndoe <johndoe@users.noreply.github.com>",
    );
  });

  test("should include PR-specific instructions only for PR events", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request_review",
        isPR: true,
        prNumber: "456",
        commentBody: "@letta-code please fix this",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain PR-specific instructions (git commands when not using signing)
    expect(prompt).toContain("git push");
    expect(prompt).toContain(
      "Always push to the existing branch when triggered on a PR",
    );

    // Should NOT contain Issue-specific instructions
    expect(prompt).not.toContain("You are already on the correct branch (");
    expect(prompt).not.toContain(
      "IMPORTANT: You are already on the correct branch (",
    );
    expect(prompt).not.toContain("Create a PR](https://github.com/");
  });

  test("should include Issue-specific instructions only for Issue events", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "opened",
        isPR: false,
        issueNumber: "789",
        baseBranch: "main",
        lettaBranch: "letta/issue-789-20240101-1200",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain Issue-specific instructions
    expect(prompt).toContain(
      "You are already on the correct branch (letta/issue-789-20240101-1200)",
    );
    expect(prompt).toContain(
      "IMPORTANT: You are already on the correct branch (letta/issue-789-20240101-1200)",
    );
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain(
      "If you created anything in your branch, you must create a PR using `gh pr create`",
    );

    // Should NOT contain PR-specific instructions
    expect(prompt).not.toContain(
      "Push directly using mcp__github_file_ops__commit_files to the existing branch",
    );
    expect(prompt).not.toContain(
      "Always push to the existing branch when triggered on a PR",
    );
  });

  test("should use actual branch name for issue comments", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: false,
        issueNumber: "123",
        baseBranch: "main",
        lettaBranch: "letta/issue-123-20240101-1200",
        commentBody: "@letta-code please fix this",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain the actual branch name with timestamp
    expect(prompt).toContain(
      "You are already on the correct branch (letta/issue-123-20240101-1200)",
    );
    expect(prompt).toContain(
      "IMPORTANT: You are already on the correct branch (letta/issue-123-20240101-1200)",
    );
    expect(prompt).toContain("gh pr create");
  });

  test("should handle closed PR with new branch", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: true,
        prNumber: "456",
        commentBody: "@letta-code please fix this",
        lettaBranch: "letta/pr-456-20240101-1200",
        baseBranch: "main",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain branch-specific instructions like issues
    expect(prompt).toContain(
      "You are already on the correct branch (letta/pr-456-20240101-1200)",
    );
    expect(prompt).toContain(
      "Create a PR](https://github.com/owner/repo/compare/main",
    );
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("Reference to the original PR");
    expect(prompt).toContain(
      "If you created anything in your branch, you must create a PR using `gh pr create`",
    );

    // Should NOT contain open PR instructions
    expect(prompt).not.toContain(
      "Push directly using mcp__github_file_ops__commit_files to the existing branch",
    );
  });

  test("should handle open PR without new branch", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: true,
        prNumber: "456",
        commentBody: "@letta-code please fix this",
        // No lettaBranch or baseBranch for open PRs
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain open PR instructions (git commands when not using signing)
    expect(prompt).toContain("git push");
    expect(prompt).toContain(
      "Always push to the existing branch when triggered on a PR",
    );

    // Should NOT contain new branch instructions
    expect(prompt).not.toContain("Create a PR](https://github.com/");
    expect(prompt).not.toContain("You are already on the correct branch");
    expect(prompt).not.toContain(
      "If you created anything in your branch, your comment must include the PR URL",
    );
  });

  test("should handle PR review on closed PR with new branch", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request_review",
        isPR: true,
        prNumber: "789",
        commentBody: "@letta-code please update this",
        lettaBranch: "letta/pr-789-20240101-1230",
        baseBranch: "develop",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain new branch instructions
    expect(prompt).toContain(
      "You are already on the correct branch (letta/pr-789-20240101-1230)",
    );
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("Reference to the original PR");
  });

  test("should handle PR review comment on closed PR with new branch", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request_review_comment",
        isPR: true,
        prNumber: "999",
        commentId: "review-comment-123",
        commentBody: "@letta-code fix this issue",
        lettaBranch: "letta/pr-999-20240101-1400",
        baseBranch: "main",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain new branch instructions
    expect(prompt).toContain(
      "You are already on the correct branch (letta/pr-999-20240101-1400)",
    );
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("Reference to the original PR");
    expect(prompt).toContain(
      "If you created anything in your branch, you must create a PR using `gh pr create`",
    );
  });

  test("should handle pull_request event on closed PR with new branch", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request",
        eventAction: "closed",
        isPR: true,
        prNumber: "555",
        lettaBranch: "letta/pr-555-20240101-1500",
        baseBranch: "main",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should contain new branch instructions
    expect(prompt).toContain(
      "You are already on the correct branch (letta/pr-555-20240101-1500)",
    );
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("Reference to the original PR");
  });

  test("should include git commands when useCommitSigning is false", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: true,
        prNumber: "123",
        commentBody: "@letta-code fix the bug",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      false,
      mockTagMode,
    );

    // Should have git command instructions (Letta uses Bash via Skills)
    expect(prompt).toContain("Use git commands via the Bash tool");
    expect(prompt).toContain("git add");
    expect(prompt).toContain("git commit");
    expect(prompt).toContain("git push");
  });

  test("should always include git commands (Letta uses Skills instead of MCP)", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issue_comment",
        commentId: "67890",
        isPR: true,
        prNumber: "123",
        commentBody: "@letta-code fix the bug",
      },
    };

    const prompt = await generatePrompt(
      envVars,
      mockGitHubData,
      true,
      mockTagMode,
    );

    // Should always have git command instructions (Letta uses Bash via Skills)
    expect(prompt).toContain("Use git commands via the Bash tool");
    expect(prompt).toContain("git add");
    expect(prompt).toContain("git commit");
    expect(prompt).toContain("git push");
  });
});

describe("getEventTypeAndContext", () => {
  test("should return correct type and context for pull_request_review_comment", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "pull_request_review_comment",
        isPR: true,
        prNumber: "123",
        commentBody: "@letta-code please fix this",
      },
    };

    const result = getEventTypeAndContext(envVars);

    expect(result.eventType).toBe("REVIEW_COMMENT");
    expect(result.triggerContext).toBe("PR review comment with '@letta-code'");
  });

  test("should return correct type and context for issue assigned", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "assigned",
        isPR: false,
        issueNumber: "999",
        baseBranch: "main",
        lettaBranch: "letta/issue-999-20240101-1200",
        assigneeTrigger: "letta-bot",
      },
    };

    const result = getEventTypeAndContext(envVars);

    expect(result.eventType).toBe("ISSUE_ASSIGNED");
    expect(result.triggerContext).toBe("issue assigned to 'letta-bot'");
  });

  test("should return correct type and context for issue labeled", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      eventData: {
        eventName: "issues",
        eventAction: "labeled",
        isPR: false,
        issueNumber: "888",
        baseBranch: "main",
        lettaBranch: "letta/issue-888-20240101-1200",
        labelTrigger: "letta-task",
      },
    };

    const result = getEventTypeAndContext(envVars);

    expect(result.eventType).toBe("ISSUE_LABELED");
    expect(result.triggerContext).toBe("issue labeled with 'letta-task'");
  });

  test("should return correct type and context for issue assigned without assigneeTrigger", async () => {
    const envVars: PreparedContext = {
      repository: "owner/repo",
      lettaCommentId: "12345",
      triggerPhrase: "@letta-code",
      prompt: "Please assess this issue",
      eventData: {
        eventName: "issues",
        eventAction: "assigned",
        isPR: false,
        issueNumber: "999",
        baseBranch: "main",
        lettaBranch: "letta/issue-999-20240101-1200",
        // No assigneeTrigger when using prompt
      },
    };

    const result = getEventTypeAndContext(envVars);

    expect(result.eventType).toBe("ISSUE_ASSIGNED");
    expect(result.triggerContext).toBe("issue assigned event");
  });
});

describe("buildAllowedToolsString", () => {
  test("should return correct tools for regular events (default no signing)", async () => {
    const result = buildAllowedToolsString();

    // The base tools should be in the result
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
    expect(result).toContain("LS");
    expect(result).toContain("Read");
    expect(result).toContain("Write");

    // Should have Bash commands for git and gh CLI (Letta uses Skills instead of MCP)
    expect(result).toContain("Bash(git add:*)");
    expect(result).toContain("Bash(git commit:*)");
    expect(result).toContain("Bash(git push:*)");
    expect(result).toContain("Bash(gh api:*)");
  });

  test("should return correct tools with default parameters", async () => {
    const result = buildAllowedToolsString([], false, false);

    // The base tools should be in the result
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
    expect(result).toContain("LS");
    expect(result).toContain("Read");
    expect(result).toContain("Write");

    // Should have Bash commands for git and gh CLI
    expect(result).toContain("Bash(git add:*)");
    expect(result).toContain("Bash(git commit:*)");
    expect(result).toContain("Bash(gh api:*)");
  });

  test("should append custom tools when provided", async () => {
    const customTools = ["Tool1", "Tool2", "Tool3"];
    const result = buildAllowedToolsString(customTools);

    // Base tools should be present
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");

    // Custom tools should be appended
    expect(result).toContain("Tool1");
    expect(result).toContain("Tool2");
    expect(result).toContain("Tool3");

    // Verify format with comma separation
    const basePlusCustom = result.split(",");
    expect(basePlusCustom.length).toBeGreaterThan(10); // At least the base tools plus custom
    expect(basePlusCustom).toContain("Tool1");
    expect(basePlusCustom).toContain("Tool2");
    expect(basePlusCustom).toContain("Tool3");
  });

  test("should include gh CLI commands", async () => {
    const result = buildAllowedToolsString([], true);

    // Base tools should be present
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");

    // gh CLI commands should be included (Letta uses Skills instead of MCP)
    expect(result).toContain("Bash(gh api:*)");
    expect(result).toContain("Bash(gh pr:*)");
    expect(result).toContain("Bash(gh issue:*)");
  });

  test("should include both custom and git tools when both provided", async () => {
    const customTools = ["Tool1", "Tool2"];
    const result = buildAllowedToolsString(customTools, true);

    // Base tools should be present
    expect(result).toContain("Edit");

    // Custom tools should be included
    expect(result).toContain("Tool1");
    expect(result).toContain("Tool2");

    // Git commands should be included
    expect(result).toContain("Bash(git add:*)");
    expect(result).toContain("Bash(git commit:*)");
  });

  test("should always include Bash git commands", async () => {
    const result = buildAllowedToolsString([], false, true);

    // Base tools should be present
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
    expect(result).toContain("LS");
    expect(result).toContain("Read");
    expect(result).toContain("Write");

    // Bash git commands should always be included (Letta uses Skills)
    expect(result).toContain("Bash(git add:*)");
    expect(result).toContain("Bash(git commit:*)");
    expect(result).toContain("Bash(git push:*)");
  });

  test("should include specific Bash git commands", async () => {
    const result = buildAllowedToolsString([], false, false);

    // Base tools should be present
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
    expect(result).toContain("LS");
    expect(result).toContain("Read");
    expect(result).toContain("Write");

    // Specific Bash git commands should be included
    expect(result).toContain("Bash(git add:*)");
    expect(result).toContain("Bash(git commit:*)");
    expect(result).toContain("Bash(git push:*)");
    expect(result).toContain("Bash(git status:*)");
    expect(result).toContain("Bash(git diff:*)");
    expect(result).toContain("Bash(git log:*)");
    expect(result).toContain("Bash(git rm:*)");
  });

  test("should handle all combinations of options", async () => {
    const customTools = ["CustomTool1", "CustomTool2"];
    const result = buildAllowedToolsString(customTools, true, false);

    // Base tools should be present
    expect(result).toContain("Edit");
    expect(result).toContain("Bash(git add:*)");

    // Custom tools should be included
    expect(result).toContain("CustomTool1");
    expect(result).toContain("CustomTool2");

    // gh commands should be included
    expect(result).toContain("Bash(gh api:*)");
  });
});

describe("buildDisallowedToolsString", () => {
  test("should return base disallowed tools when no custom tools provided", async () => {
    const result = buildDisallowedToolsString();

    // The base disallowed tools should be in the result
    expect(result).toContain("WebSearch");
    expect(result).toContain("WebFetch");
  });

  test("should append custom disallowed tools when provided", async () => {
    const customDisallowedTools = ["BadTool1", "BadTool2"];
    const result = buildDisallowedToolsString(customDisallowedTools);

    // Base disallowed tools should be present
    expect(result).toContain("WebSearch");

    // Custom disallowed tools should be appended
    expect(result).toContain("BadTool1");
    expect(result).toContain("BadTool2");

    // Verify format with comma separation
    const parts = result.split(",");
    expect(parts).toContain("WebSearch");
    expect(parts).toContain("BadTool1");
    expect(parts).toContain("BadTool2");
  });

  test("should remove hardcoded disallowed tools if they are in allowed tools", async () => {
    const customDisallowedTools = ["BadTool1", "BadTool2"];
    const allowedTools = ["WebSearch", "SomeOtherTool"];
    const result = buildDisallowedToolsString(
      customDisallowedTools,
      allowedTools,
    );

    // WebSearch should be removed from disallowed since it's in allowed
    expect(result).not.toContain("WebSearch");

    // WebFetch should still be disallowed since it's not in allowed
    expect(result).toContain("WebFetch");

    // Custom disallowed tools should still be present
    expect(result).toContain("BadTool1");
    expect(result).toContain("BadTool2");
  });

  test("should remove all hardcoded disallowed tools if they are all in allowed tools", async () => {
    const allowedTools = ["WebSearch", "WebFetch", "SomeOtherTool"];
    const result = buildDisallowedToolsString(undefined, allowedTools);

    // Both hardcoded disallowed tools should be removed
    expect(result).not.toContain("WebSearch");
    expect(result).not.toContain("WebFetch");

    // Result should be empty since no custom disallowed tools provided
    expect(result).toBe("");
  });

  test("should handle custom disallowed tools when all hardcoded tools are overridden", async () => {
    const customDisallowedTools = ["BadTool1", "BadTool2"];
    const allowedTools = ["WebSearch", "WebFetch"];
    const result = buildDisallowedToolsString(
      customDisallowedTools,
      allowedTools,
    );

    // Hardcoded tools should be removed
    expect(result).not.toContain("WebSearch");
    expect(result).not.toContain("WebFetch");

    // Only custom disallowed tools should remain
    expect(result).toBe("BadTool1,BadTool2");
  });
});
