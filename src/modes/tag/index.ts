import * as core from "@actions/core";
import type { Mode, ModeOptions, ModeResult } from "../types";
import { checkContainsTrigger } from "../../github/validation/trigger";
import { checkHumanActor } from "../../github/validation/actor";
import { createInitialComment } from "../../github/operations/comments/create-initial";
import { setupBranch } from "../../github/operations/branch";
import { configureGitAuth } from "../../github/operations/git-config";
import {
  fetchGitHubData,
  extractTriggerTimestamp,
} from "../../github/data/fetcher";
import { createPrompt, generateDefaultPrompt } from "../../create-prompt";
import { isEntityContext } from "../../github/context";
import type { PreparedContext } from "../../create-prompt/types";
import type { FetchDataResult } from "../../github/data/fetcher";
import { findExistingAgent } from "../../letta/find-existing-agent";
import { parseTriggerFromContext } from "../../letta/trigger-parser";

/**
 * Tag mode implementation.
 *
 * The traditional implementation mode that responds to @letta mentions,
 * issue assignments, or labels. Creates tracking comments showing progress
 * and has full implementation capabilities.
 *
 * For Letta Code, we use Skills instead of MCP servers. The github-action
 * skill teaches the agent how to update comments via gh CLI.
 */
export const tagMode: Mode = {
  name: "tag",
  description:
    "Traditional implementation mode triggered by @letta-code mentions",

  shouldTrigger(context) {
    // Tag mode only handles entity events
    if (!isEntityContext(context)) {
      return false;
    }
    return checkContainsTrigger(context);
  },

  prepareContext(context, data) {
    return {
      mode: "tag",
      githubContext: context,
      commentId: data?.commentId,
      baseBranch: data?.baseBranch,
      lettaBranch: data?.lettaBranch,
    };
  },

  getAllowedTools() {
    return [];
  },

  getDisallowedTools() {
    return [];
  },

  shouldCreateTrackingComment() {
    return true;
  },

  async prepare({
    context,
    octokit,
    githubToken,
  }: ModeOptions): Promise<ModeResult> {
    // Tag mode only handles entity-based events
    if (!isEntityContext(context)) {
      throw new Error("Tag mode requires entity context");
    }

    // Check if actor is human
    await checkHumanActor(octokit.rest, context);

    // Extract PR body if this is a PR (for linked issue search)
    let prBody: string | undefined;
    if (context.isPR && context.payload) {
      if ("pull_request" in context.payload && context.payload.pull_request) {
        prBody = (context.payload.pull_request as { body?: string }).body || "";
      } else if ("issue" in context.payload && context.payload.issue) {
        // For issue_comment on a PR, the issue object has the body
        prBody = (context.payload.issue as { body?: string }).body || "";
      }
    }

    // Check if user configured a specific agent ID to use
    const configuredAgentId = context.inputs.agentId;

    if (configuredAgentId) {
      // User specified an agent ID - use it and search for existing conversation
      console.log(`Using configured agent: ${configuredAgentId}`);
      core.setOutput("agent_id", configuredAgentId);

      // Still check for existing conversation in this issue/PR
      const existingAgent = await findExistingAgent(
        octokit.rest,
        context.repository.owner,
        context.repository.repo,
        context.entityNumber,
        {
          isPR: context.isPR,
          prBody,
        },
      );

      if (existingAgent?.conversationId) {
        // Resume existing conversation
        console.log(
          `Resuming existing conversation: ${existingAgent.conversationId}`,
        );
        core.setOutput("conversation_id", existingAgent.conversationId);
        core.setOutput("is_followup", "true");
        core.setOutput("create_new_conversation", "false");
      } else {
        // No existing conversation - create new one on the configured agent
        console.log(
          `No existing conversation found, will create new conversation on configured agent`,
        );
        core.setOutput("is_followup", "false");
        core.setOutput("create_new_conversation", "true");
      }
    } else {
      // No configured agent - check for existing Letta agent in this issue/PR
      // Also searches linked issues if this is a PR (e.g., "Fixes #123")
      const existingAgent = await findExistingAgent(
        octokit.rest,
        context.repository.owner,
        context.repository.repo,
        context.entityNumber,
        {
          isPR: context.isPR,
          prBody,
        },
      );

      if (existingAgent) {
        core.setOutput("agent_id", existingAgent.agentId);

        if (existingAgent.conversationId) {
          // Resume existing conversation
          const linkedMsg = existingAgent.linkedFromIssue
            ? ` (linked from issue #${existingAgent.linkedFromIssue})`
            : "";
          console.log(
            `Resuming existing conversation: ${existingAgent.conversationId} (agent: ${existingAgent.agentId})${linkedMsg}`,
          );
          core.setOutput("conversation_id", existingAgent.conversationId);
          core.setOutput("is_followup", "true");
          core.setOutput("create_new_conversation", "false");

          if (existingAgent.linkedFromIssue) {
            core.setOutput(
              "linked_from_issue",
              existingAgent.linkedFromIssue.toString(),
            );
          }
        } else {
          // Found agent but no conversation - create new conversation on existing agent
          console.log(
            `Found existing agent: ${existingAgent.agentId}, will create new conversation`,
          );
          core.setOutput("is_followup", "true");
          core.setOutput("create_new_conversation", "true");
        }
      } else {
        console.log(
          "No existing agent found, will create new agent and conversation",
        );
        core.setOutput("is_followup", "false");
        core.setOutput("create_new_conversation", "true");
      }
    }

    // Create initial tracking comment
    const commentData = await createInitialComment(octokit.rest, context);
    const commentId = commentData.id;

    const triggerTime = extractTriggerTimestamp(context);

    const githubData = await fetchGitHubData({
      octokits: octokit,
      repository: `${context.repository.owner}/${context.repository.repo}`,
      prNumber: context.entityNumber.toString(),
      isPR: context.isPR,
      triggerUsername: context.actor,
      triggerTime,
    });

    // Setup branch
    const branchInfo = await setupBranch(octokit, githubData, context);

    // Configure git authentication if not using commit signing
    if (!context.inputs.useCommitSigning) {
      // Use bot_id and bot_name from inputs directly
      const user = {
        login: context.inputs.botName,
        id: parseInt(context.inputs.botId),
      };

      try {
        await configureGitAuth(githubToken, context, user);
      } catch (error) {
        console.error("Failed to configure git authentication:", error);
        throw error;
      }
    }

    // Create prompt file
    const modeContext = this.prepareContext(context, {
      commentId,
      baseBranch: branchInfo.baseBranch,
      lettaBranch: branchInfo.lettaBranch,
    });

    await createPrompt(tagMode, modeContext, githubData, context);

    // For Letta Code, we don't pass tool restrictions via CLI flags
    // Tools are managed by the Letta platform, and the github-action skill
    // teaches the agent how to use gh CLI for comment updates

    // Parse trigger for bracket syntax: @letta [--model haiku] do something
    const parsedTrigger = parseTriggerFromContext(context);

    // Combine parsed args with any user-provided args from workflow
    const envLettaArgs = process.env.LETTA_ARGS || "";
    const allArgs = [
      ...parsedTrigger.lettaArgs,
      ...envLettaArgs.split(/\s+/).filter((a: string) => a),
    ];

    core.setOutput("letta_args", allArgs.join(" "));

    // Output warnings if any
    if (parsedTrigger.warnings.length > 0) {
      core.setOutput("trigger_warnings", parsedTrigger.warnings.join("; "));
      console.log(`Trigger warnings: ${parsedTrigger.warnings.join("; ")}`);
    }
    if (parsedTrigger.parseError) {
      core.setOutput("trigger_parse_error", parsedTrigger.parseError);
      console.log(`Trigger parse error: ${parsedTrigger.parseError}`);
    }

    return {
      commentId,
      branchInfo,
    };
  },

  generatePrompt(
    context: PreparedContext,
    githubData: FetchDataResult,
    useCommitSigning: boolean,
  ): string {
    const defaultPrompt = generateDefaultPrompt(
      context,
      githubData,
      useCommitSigning,
    );

    // If a custom prompt is provided, inject it into the tag mode prompt
    if (context.githubContext?.inputs?.prompt) {
      return (
        defaultPrompt +
        `

<custom_instructions>
${context.githubContext.inputs.prompt}
</custom_instructions>`
      );
    }

    return defaultPrompt;
  },

  getSystemPrompt() {
    // Tag mode doesn't need additional system prompts
    return undefined;
  },
};
