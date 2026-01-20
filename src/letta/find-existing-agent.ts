/**
 * Find existing Letta agent in issue/PR comments.
 *
 * Searches for comments with letta-metadata to enable agent persistence
 * across multiple @letta mentions in the same issue/PR.
 *
 * Also supports cross-referencing: if this is a PR that references an issue
 * (via "Fixes #X", "Closes #X", etc.), we'll search that issue's comments too.
 */

import type { RestEndpointMethodTypes } from "@octokit/rest";
import { parseMetadata } from "./metadata";
import { LETTA_APP_BOT_ID } from "../github/constants";

type IssueComment =
  RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][0];

export interface ExistingAgentInfo {
  agentId: string;
  conversationId?: string;
  model?: string;
  commentId: number;
  created?: string;
  /** If found via linked issue, indicates which issue */
  linkedFromIssue?: number;
}

/**
 * Extract linked issue numbers from PR body.
 * Looks for patterns like "Fixes #123", "Closes #456", "Resolves #789", etc.
 */
export function extractLinkedIssues(body: string | null | undefined): number[] {
  if (!body) return [];

  // Match patterns: Fixes #123, Closes #123, Resolves #123, etc.
  // Also matches: fix #123, close #123, resolve #123 (case insensitive)
  // And: Fixes: #123, Closes: #123 (with optional colon)
  const patterns = [
    /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?):?\s*#(\d+)/gi,
    /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?):?\s+#(\d+)/gi,
  ];

  const issues = new Set<number>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      if (match[1]) {
        issues.add(parseInt(match[1], 10));
      }
    }
  }

  return Array.from(issues);
}

type OctokitIssues = {
  listComments: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page?: number;
    sort?: "created" | "updated";
    direction?: "asc" | "desc";
  }) => Promise<{ data: IssueComment[] }>;
};

export interface FindExistingAgentOptions {
  /** Whether this is a PR (enables linked issue search) */
  isPR?: boolean;
  /** The PR body (used to extract linked issues) */
  prBody?: string | null;
}

/**
 * Search comments in a single issue/PR for Letta metadata.
 * Returns the first matching agent info found.
 */
async function searchCommentsForAgent(
  octokit: { issues: OctokitIssues },
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<ExistingAgentInfo | null> {
  const response = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
    sort: "created",
    direction: "desc",
  });

  for (const comment of response.data) {
    // Check if this is a Letta bot comment
    const isLettaBot =
      comment.user?.id === LETTA_APP_BOT_ID ||
      (comment.user?.type === "Bot" &&
        comment.user?.login.toLowerCase().includes("letta")) ||
      // Also check for github-actions bot (used in CI)
      comment.user?.login === "github-actions[bot]";

    if (!isLettaBot || !comment.body) {
      continue;
    }

    // Try to parse metadata from comment
    const metadata = parseMetadata(comment.body);
    if (metadata) {
      return {
        agentId: metadata.agentId,
        conversationId: metadata.conversationId,
        model: metadata.model,
        commentId: comment.id,
        created: metadata.created,
      };
    }
  }

  return null;
}

/**
 * Find existing Letta agent from previous comments in this issue/PR.
 *
 * If this is a PR and no conversation is found in PR comments, also searches
 * any linked issues (via "Fixes #X", "Closes #X", etc.) to continue that
 * conversation on the PR.
 *
 * @param octokit - Octokit REST client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue or PR number
 * @param options - Additional options (isPR, prBody)
 * @returns Agent info if found, null otherwise
 */
export async function findExistingAgent(
  octokit: { issues: OctokitIssues },
  owner: string,
  repo: string,
  issueNumber: number,
  options?: FindExistingAgentOptions,
): Promise<ExistingAgentInfo | null> {
  try {
    // First, search comments in the current issue/PR
    const result = await searchCommentsForAgent(
      octokit,
      owner,
      repo,
      issueNumber,
    );

    if (result) {
      console.log(
        `Found existing agent: ${result.agentId}${result.conversationId ? ` with conversation: ${result.conversationId}` : ""} in comment ${result.commentId}`,
      );
      return result;
    }

    // If this is a PR and no conversation found, search linked issues
    if (options?.isPR && options?.prBody) {
      const linkedIssues = extractLinkedIssues(options.prBody);

      if (linkedIssues.length > 0) {
        console.log(
          `No conversation in PR, searching ${linkedIssues.length} linked issue(s): ${linkedIssues.join(", ")}`,
        );

        for (const linkedIssueNumber of linkedIssues) {
          try {
            const linkedResult = await searchCommentsForAgent(
              octokit,
              owner,
              repo,
              linkedIssueNumber,
            );

            if (linkedResult) {
              console.log(
                `Found existing conversation in linked issue #${linkedIssueNumber}: ${linkedResult.conversationId || linkedResult.agentId}`,
              );
              return {
                ...linkedResult,
                linkedFromIssue: linkedIssueNumber,
              };
            }
          } catch (error) {
            console.warn(
              `Failed to search linked issue #${linkedIssueNumber}:`,
              error,
            );
            // Continue searching other linked issues
          }
        }
      }
    }

    console.log("No existing Letta agent found in comments");
    return null;
  } catch (error) {
    console.error("Error searching for existing agent:", error);
    return null;
  }
}
