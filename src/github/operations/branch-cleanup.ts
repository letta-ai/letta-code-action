import type { Octokits } from "../api/client";
import { GITHUB_SERVER_URL } from "../api/config";
import { $ } from "bun";

export async function checkAndCommitOrDeleteBranch(
  octokit: Octokits,
  owner: string,
  repo: string,
  lettaBranch: string | undefined,
  baseBranch: string,
  useCommitSigning: boolean,
): Promise<{ shouldDeleteBranch: boolean; branchLink: string }> {
  let branchLink = "";
  let shouldDeleteBranch = false;

  if (lettaBranch) {
    // First check if the branch exists remotely
    let branchExistsRemotely = false;
    try {
      await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: lettaBranch,
      });
      branchExistsRemotely = true;
    } catch (error: any) {
      if (error.status === 404) {
        console.log(`Branch ${lettaBranch} does not exist remotely`);
      } else {
        console.error("Error checking if branch exists:", error);
      }
    }

    // Only proceed if branch exists remotely
    if (!branchExistsRemotely) {
      console.log(
        `Branch ${lettaBranch} does not exist remotely, no branch link will be added`,
      );
      return { shouldDeleteBranch: false, branchLink: "" };
    }

    // Check if Letta made any commits to the branch
    try {
      const { data: comparison } =
        await octokit.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${baseBranch}...${lettaBranch}`,
        });

      // If there are no commits, check for uncommitted changes if not using commit signing
      if (comparison.total_commits === 0) {
        if (!useCommitSigning) {
          console.log(
            `Branch ${lettaBranch} has no commits from Letta, checking for uncommitted changes...`,
          );

          // Check for uncommitted changes using git status
          try {
            const gitStatus = await $`git status --porcelain`.quiet();
            const hasUncommittedChanges =
              gitStatus.stdout.toString().trim().length > 0;

            if (hasUncommittedChanges) {
              console.log("Found uncommitted changes, committing them...");

              // Add all changes
              await $`git add -A`;

              // Commit with a descriptive message
              const runId = process.env.GITHUB_RUN_ID || "unknown";
              const commitMessage = `Auto-commit: Save uncommitted changes from Letta\n\nRun ID: ${runId}`;
              await $`git commit -m ${commitMessage}`;

              // Push the changes
              await $`git push origin ${lettaBranch}`;

              console.log(
                "✅ Successfully committed and pushed uncommitted changes",
              );

              // Set branch link since we now have commits
              const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${lettaBranch}`;
              branchLink = `\n[View branch](${branchUrl})`;
            } else {
              console.log(
                "No uncommitted changes found, marking branch for deletion",
              );
              shouldDeleteBranch = true;
            }
          } catch (gitError) {
            console.error("Error checking/committing changes:", gitError);
            // If we can't check git status, assume the branch might have changes
            const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${lettaBranch}`;
            branchLink = `\n[View branch](${branchUrl})`;
          }
        } else {
          console.log(
            `Branch ${lettaBranch} has no commits from Letta, will delete it`,
          );
          shouldDeleteBranch = true;
        }
      } else {
        // Only add branch link if there are commits
        const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${lettaBranch}`;
        branchLink = `\n[View branch](${branchUrl})`;
      }
    } catch (error) {
      console.error("Error comparing commits on Letta branch:", error);
      // If we can't compare but the branch exists remotely, include the branch link
      const branchUrl = `${GITHUB_SERVER_URL}/${owner}/${repo}/tree/${lettaBranch}`;
      branchLink = `\n[View branch](${branchUrl})`;
    }
  }

  // Delete the branch if it has no commits
  if (shouldDeleteBranch && lettaBranch) {
    try {
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${lettaBranch}`,
      });
      console.log(`✅ Deleted empty branch: ${lettaBranch}`);
    } catch (deleteError) {
      console.error(`Failed to delete branch ${lettaBranch}:`, deleteError);
      // Continue even if deletion fails
    }
  }

  return { shouldDeleteBranch, branchLink };
}
