import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import type { PreparedContext } from "../../create-prompt/types";
import { configureGitAuth } from "../../github/operations/git-config";
import type { GitHubContext } from "../../github/context";
import { isEntityContext } from "../../github/context";
import { findExistingAgent } from "../../letta/find-existing-agent";
import { createInitialComment } from "../../github/operations/comments/create-initial";

/**
 * Extract GitHub context as environment variables for agent mode
 */
function extractGitHubContext(context: GitHubContext): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Basic repository info
  envVars.GITHUB_REPOSITORY = context.repository.full_name;
  envVars.GITHUB_TRIGGER_ACTOR = context.actor;
  envVars.GITHUB_EVENT_NAME = context.eventName;

  // Entity-specific context (PR/issue numbers, branches, etc.)
  if (isEntityContext(context)) {
    if (context.isPR) {
      envVars.GITHUB_PR_NUMBER = String(context.entityNumber);

      // Extract branch info from payload if available
      if (
        context.payload &&
        "pull_request" in context.payload &&
        context.payload.pull_request
      ) {
        envVars.GITHUB_BASE_REF = context.payload.pull_request.base?.ref || "";
        envVars.GITHUB_HEAD_REF = context.payload.pull_request.head?.ref || "";
      }
    } else {
      envVars.GITHUB_ISSUE_NUMBER = String(context.entityNumber);
    }
  }

  return envVars;
}

/**
 * Agent mode implementation.
 *
 * This mode runs whenever an explicit prompt is provided in the workflow configuration.
 * When tracking_comment is enabled, it supports conversation persistence across runs
 * on the same PR/issue (same as tag mode). When disabled, it behaves as a stateless
 * automation runner.
 */
export const agentMode: Mode = {
  name: "agent",
  description: "Direct automation mode for explicit prompts",

  shouldTrigger(context) {
    // Only trigger when an explicit prompt is provided
    return !!context.inputs?.prompt;
  },

  prepareContext(context) {
    return {
      mode: "agent",
      githubContext: context,
    };
  },

  getAllowedTools() {
    return [];
  },

  getDisallowedTools() {
    return [];
  },

  shouldCreateTrackingComment(context?: {
    inputs?: { trackingComment?: boolean };
  }) {
    return context?.inputs?.trackingComment ?? false;
  },

  async prepare({
    context,
    octokit,
    githubToken,
  }: ModeOptions): Promise<ModeResult> {
    // Configure git authentication for agent mode (same as tag mode)
    if (!context.inputs.useCommitSigning) {
      // Use bot_id and bot_name from inputs directly
      const user = {
        login: context.inputs.botName,
        id: parseInt(context.inputs.botId),
      };

      try {
        // Use the shared git configuration function
        await configureGitAuth(githubToken, context, user);
      } catch (error) {
        console.error("Failed to configure git authentication:", error);
        // Continue anyway - git operations may still work with default config
      }
    }

    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP || "/tmp"}/letta-prompts`, {
      recursive: true,
    });

    // Write the prompt file - use the user's prompt directly
    const promptContent =
      context.inputs.prompt ||
      `Repository: ${context.repository.owner}/${context.repository.repo}`;

    await writeFile(
      `${process.env.RUNNER_TEMP || "/tmp"}/letta-prompts/letta-prompt.txt`,
      promptContent,
    );

    // Check for branch info from environment variables (useful for auto-fix workflows)
    const lettaBranch = process.env.LETTA_BRANCH || undefined;
    const baseBranch =
      process.env.BASE_BRANCH || context.inputs.baseBranch || "main";

    // For Letta Code, we don't pass tool restrictions via CLI flags
    // Just pass through any user-provided args (model overrides, etc.)
    const userLettaArgs = process.env.LETTA_ARGS || "";

    // Create tracking comment if enabled (for conversation persistence)
    let commentId: number | undefined;
    if (context.inputs.trackingComment && isEntityContext(context)) {
      const commentData = await createInitialComment(octokit.rest, context);
      commentId = commentData.id;
    } else if (context.inputs.trackingComment) {
      console.log(
        "Tracking comment enabled but not on entity context, skipping initial comment",
      );
    }

    // Conversation persistence: search for existing conversation on this PR
    if (context.inputs.agentId && isEntityContext(context)) {
      core.setOutput("agent_id", context.inputs.agentId);

      const existingAgent = await findExistingAgent(
        octokit.rest,
        context.repository.owner,
        context.repository.repo,
        context.entityNumber,
        {
          isPR: context.isPR,
          prBody: context.isPR
            ? ((context.payload as { pull_request?: { body?: string } })
                .pull_request?.body ?? null)
            : null,
        },
      );

      if (
        existingAgent?.conversationId &&
        existingAgent.agentId === context.inputs.agentId
      ) {
        // Resume existing conversation
        console.log(
          `Resuming existing conversation: ${existingAgent.conversationId}`,
        );
        core.setOutput("conversation_id", existingAgent.conversationId);
        core.setOutput("is_followup", "true");
        core.setOutput("create_new_conversation", "false");
      } else {
        // No existing conversation for this agent - create new one
        console.log(
          "No existing conversation found, will create new conversation on configured agent",
        );
        core.setOutput("is_followup", "false");
        core.setOutput("create_new_conversation", "true");
      }
    } else if (context.inputs.agentId) {
      core.setOutput("agent_id", context.inputs.agentId);
      core.setOutput("create_new_conversation", "true");
    }

    core.setOutput("letta_args", userLettaArgs.trim());

    return {
      commentId,
      branchInfo: {
        baseBranch: baseBranch,
        currentBranch: baseBranch, // Use base branch as current when creating new branch
        lettaBranch: lettaBranch,
      },
    };
  },

  generatePrompt(context: PreparedContext): string {
    // Inject GitHub context as environment variables
    if (context.githubContext) {
      const envVars = extractGitHubContext(context.githubContext);
      for (const [key, value] of Object.entries(envVars)) {
        core.exportVariable(key, value);
      }
    }

    // Agent mode uses prompt field
    if (context.prompt) {
      return context.prompt;
    }

    // Minimal fallback - repository is a string in PreparedContext
    return `Repository: ${context.repository}`;
  },

  getSystemPrompt() {
    // Agent mode doesn't need additional system prompts
    return undefined;
  },
};
