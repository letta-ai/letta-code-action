/**
 * Find existing Letta agent in issue/PR comments.
 *
 * Searches for comments with letta-metadata to enable agent persistence
 * across multiple @letta mentions in the same issue/PR.
 */

import type { RestEndpointMethodTypes } from "@octokit/rest";
import { parseMetadata } from "./metadata";
import { LETTA_APP_BOT_ID } from "../github/constants";

type IssueComment =
  RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][0];

export interface ExistingAgentInfo {
  agentId: string;
  model?: string;
  commentId: number;
  created?: string;
}

/**
 * Find existing Letta agent from previous comments in this issue/PR
 *
 * @param octokit - Octokit REST client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue or PR number
 * @returns Agent info if found, null otherwise
 */
export async function findExistingAgent(
  octokit: {
    issues: {
      listComments: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page?: number;
        sort?: "created" | "updated";
        direction?: "asc" | "desc";
      }) => Promise<{ data: IssueComment[] }>;
    };
  },
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<ExistingAgentInfo | null> {
  try {
    // Fetch comments, most recent first
    const response = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      sort: "created",
      direction: "desc",
    });

    // Search for Letta bot comments with metadata
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
        console.log(
          `Found existing agent: ${metadata.agentId} in comment ${comment.id}`,
        );
        return {
          agentId: metadata.agentId,
          model: metadata.model,
          commentId: comment.id,
          created: metadata.created,
        };
      }
    }

    console.log("No existing Letta agent found in comments");
    return null;
  } catch (error) {
    console.error("Error searching for existing agent:", error);
    return null;
  }
}
