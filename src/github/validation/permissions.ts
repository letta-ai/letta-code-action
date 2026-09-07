import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { Octokit } from "@octokit/rest";

/**
 * Check if the actor has write permissions to the repository
 * @param octokit - The Octokit REST client
 * @param context - The GitHub context
 * @param allowedNonWriteUsers - Comma-separated list of users allowed without write permissions, or '*' for all
 * @param githubTokenProvided - Whether github_token was provided as input (not from app)
 * @returns true if the actor has write permissions, false otherwise
 */
export async function checkWritePermissions(
  octokit: Octokit,
  context: ParsedGitHubContext,
  allowedNonWriteUsers?: string,
  githubTokenProvided?: boolean,
): Promise<boolean> {
  const { repository, actor } = context;

  try {
    core.info(`Checking permissions for actor: ${actor}`);

    // Check if we should bypass permission checks for this user
    if (allowedNonWriteUsers && githubTokenProvided) {
      const allowedUsers = allowedNonWriteUsers.trim();
      if (allowedUsers === "*") {
        core.warning(
          `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users='*'. This should only be used for workflows with very limited permissions.`,
        );
        return true;
      } else if (allowedUsers) {
        const allowedUserList = allowedUsers
          .split(",")
          .map((u) => u.trim())
          .filter((u) => u.length > 0);
        if (allowedUserList.includes(actor)) {
          core.warning(
            `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users configuration. This should only be used for workflows with very limited permissions.`,
          );
          return true;
        }
      }
    }

    // Check if the actor is a GitHub App (bot user)
    if (actor.endsWith("[bot]")) {
      core.info(`Actor is a GitHub App: ${actor}`);
      return true;
    }

    // Check permissions directly using the permission endpoint.
    const response = await octokit.repos.getCollaboratorPermissionLevel({
      owner: repository.owner,
      repo: repository.repo,
      username: actor,
    });

    const permissionLevel = response.data.permission;
    core.info(`Permission level retrieved: ${permissionLevel}`);

    if (permissionLevel === "admin" || permissionLevel === "write") {
      core.info(`Actor has write access: ${permissionLevel}`);
      return true;
    }

    // GitHub keeps github.actor set to the external contributor when a
    // maintainer approves and starts (or reruns) a fork workflow. The
    // maintainer is exposed separately as github.triggering_actor. Accept the
    // run only after independently verifying that user has write access.
    const triggeringActor = context.triggeringActor;
    if (triggeringActor && triggeringActor !== actor) {
      core.info(
        `Actor has insufficient permissions: ${permissionLevel}; checking triggering actor: ${triggeringActor}`,
      );
      const triggeringResponse =
        await octokit.repos.getCollaboratorPermissionLevel({
          owner: repository.owner,
          repo: repository.repo,
          username: triggeringActor,
        });
      const triggeringPermission = triggeringResponse.data.permission;
      core.info(
        `Triggering actor permission level retrieved: ${triggeringPermission}`,
      );
      if (
        triggeringPermission === "admin" ||
        triggeringPermission === "write"
      ) {
        core.info(`Triggering actor has write access: ${triggeringPermission}`);
        return true;
      }
      core.warning(
        `Actor and triggering actor have insufficient permissions: ${permissionLevel}, ${triggeringPermission}`,
      );
      return false;
    }

    core.warning(`Actor has insufficient permissions: ${permissionLevel}`);
    return false;
  } catch (error) {
    core.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for ${actor}: ${error}`);
  }
}
