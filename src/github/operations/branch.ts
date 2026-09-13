#!/usr/bin/env bun

/**
 * Setup the appropriate branch based on the event type:
 * - For PRs: Checkout the PR branch
 * - For Issues: Create a new branch
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { GitHubPullRequest } from "../types";
import type { Octokits } from "../api/client";
import { computeChangedFileSHAs, type FetchDataResult } from "../data/fetcher";

export type BranchInfo = {
  baseBranch: string;
  lettaBranch?: string;
  currentBranch: string;
};

export type PullRequestBranchPlan = {
  fetchRef: string;
  checkoutBranch: string;
  lettaBranch?: string;
  legacyLettaBranch?: string;
};

export type SetupBranchOptions = {
  cwd?: string;
  setOutput?: typeof core.setOutput;
};

function withCwd(
  command: ReturnType<typeof $>,
  cwd?: string,
): ReturnType<typeof $> {
  return cwd ? command.cwd(cwd) : command;
}

export function getPullRequestBranchPlan(
  entityNumber: number,
  headRefName: string,
  isCrossRepository: boolean,
  branchPrefix: string,
): PullRequestBranchPlan {
  const checkoutBranch = isCrossRepository
    ? `letta-pr-${entityNumber}`
    : headRefName;
  const reviewBranchSuffix = `pr-${entityNumber}-review`;
  const normalizedReviewBranchPrefix = branchPrefix.toLowerCase();
  const legacyLettaBranch =
    `${normalizedReviewBranchPrefix}${reviewBranchSuffix}`.substring(0, 50);
  const maxReviewBranchPrefixLength = Math.max(
    0,
    50 - reviewBranchSuffix.length,
  );
  let reviewBranchPrefix = normalizedReviewBranchPrefix.substring(
    0,
    maxReviewBranchPrefixLength,
  );

  if (normalizedReviewBranchPrefix.length > maxReviewBranchPrefixLength) {
    reviewBranchPrefix = reviewBranchPrefix.replace(/[^/-]*$/, "");
  }

  const lettaBranch = `${reviewBranchPrefix}${reviewBranchSuffix}`;

  return {
    fetchRef: `refs/pull/${entityNumber}/head`,
    checkoutBranch,
    ...(isCrossRepository && {
      lettaBranch,
      ...(legacyLettaBranch !== lettaBranch && {
        legacyLettaBranch,
      }),
    }),
  };
}

async function remoteBranchExists(
  branchName: string,
  cwd?: string,
): Promise<boolean> {
  const expectedRef = `refs/heads/${branchName}`;
  try {
    const output = await withCwd(
      $`git ls-remote --heads origin ${expectedRef}`,
      cwd,
    )
      .quiet()
      .text();
    return output
      .split("\n")
      .some((line) => line.split(/\s+/)[1] === expectedRef);
  } catch {
    return false;
  }
}

async function isValidBranchName(
  branchName: string,
  cwd?: string,
): Promise<boolean> {
  try {
    await withCwd($`git check-ref-format --branch ${branchName}`, cwd).quiet();
    return true;
  } catch {
    return false;
  }
}

async function assertValidBranchName(
  branchName: string,
  cwd?: string,
): Promise<void> {
  if (!(await isValidBranchName(branchName, cwd))) {
    throw new Error(
      `Invalid generated branch name "${branchName}". Check branch_prefix; generated review branches must be valid git branch names.`,
    );
  }
}

async function branchContainsCommit(
  branchName: string,
  commitish: string,
  cwd?: string,
): Promise<boolean> {
  try {
    await withCwd(
      $`git merge-base --is-ancestor ${commitish} ${branchName}`,
      cwd,
    ).quiet();
    return true;
  } catch {
    return false;
  }
}

async function deepenRemoteBranchHistory(
  branchName: string,
  cwd?: string,
): Promise<void> {
  try {
    await withCwd(
      $`git fetch origin --unshallow +refs/heads/${branchName}:${branchName}`,
      cwd,
    ).quiet();
    return;
  } catch {
    // Fall through: --unshallow fails when the repository is already complete.
  }

  try {
    await withCwd(
      $`git fetch origin --deepen=1000000 +refs/heads/${branchName}:${branchName}`,
      cwd,
    ).quiet();
    return;
  } catch {
    // Last fallback for complete repositories that reject --deepen.
  }

  await withCwd(
    $`git fetch origin +refs/heads/${branchName}:${branchName}`,
    cwd,
  ).quiet();
}

export async function setupBranch(
  octokits: Octokits,
  githubData: FetchDataResult,
  context: ParsedGitHubContext,
  options: SetupBranchOptions = {},
): Promise<BranchInfo> {
  const { cwd, setOutput = core.setOutput } = options;
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, branchPrefix } = context.inputs;
  const isPR = context.isPR;

  if (isPR) {
    const prData = githubData.contextData as GitHubPullRequest;
    const prState = prData.state;

    // Check if PR is closed or merged
    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
      // Fall through to create a new branch like we do for issues
    } else {
      // Handle open PR: Checkout the PR branch
      console.log("This is an open PR, checking out PR branch...");

      if (typeof prData.isCrossRepository !== "boolean") {
        throw new Error("PR data is missing isCrossRepository");
      }

      const { fetchRef, checkoutBranch, lettaBranch, legacyLettaBranch } =
        getPullRequestBranchPlan(
          entityNumber,
          prData.headRefName,
          prData.isCrossRepository,
          branchPrefix,
        );

      if (lettaBranch) {
        await assertValidBranchName(lettaBranch, cwd);
      }
      const validLegacyLettaBranch =
        legacyLettaBranch && (await isValidBranchName(legacyLettaBranch, cwd))
          ? legacyLettaBranch
          : undefined;

      // Determine optimal fetch depth based on PR commit count, with a minimum of 20
      const commitCount = prData.commits.totalCount;
      const fetchDepth = Math.max(commitCount, 20);

      console.log(
        `PR #${entityNumber}: ${commitCount} commits, using fetch depth ${fetchDepth}`,
      );

      // GitHub exposes pull/<number>/head for both same-repo and fork PRs.
      // Fork PRs use a synthetic local branch to avoid clobbering branches like main.
      await withCwd($`git fetch origin --depth=${fetchDepth} ${fetchRef}`, cwd);
      await withCwd($`git checkout -B ${checkoutBranch} FETCH_HEAD`, cwd);
      githubData.changedFilesWithSHA = computeChangedFileSHAs(
        true,
        githubData.changedFiles,
        cwd,
      );

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      // For open PRs, we need to get the base branch of the PR
      const baseBranch = prData.baseRefName;

      if (!prData.isCrossRepository) {
        return {
          baseBranch,
          currentBranch: checkoutBranch,
        };
      }

      if (!lettaBranch) {
        throw new Error("Fork PR checkout requires a Letta branch");
      }

      let existingLettaBranch: string | undefined;
      if (await remoteBranchExists(lettaBranch, cwd)) {
        existingLettaBranch = lettaBranch;
      } else if (
        validLegacyLettaBranch &&
        (await remoteBranchExists(validLegacyLettaBranch, cwd))
      ) {
        existingLettaBranch = validLegacyLettaBranch;
      }

      const activeLettaBranch = existingLettaBranch ?? lettaBranch;

      if (existingLettaBranch) {
        const branchKind =
          activeLettaBranch === validLegacyLettaBranch ? "legacy " : "";
        console.log(
          `Reusing existing ${branchKind}Letta branch: ${activeLettaBranch}`,
        );
        await withCwd(
          $`git fetch origin --depth=${fetchDepth} +refs/heads/${activeLettaBranch}:${activeLettaBranch}`,
          cwd,
        );
        if (
          !(await branchContainsCommit(activeLettaBranch, checkoutBranch, cwd))
        ) {
          console.log(
            `Deepening existing Letta branch ${activeLettaBranch} before stale branch check...`,
          );
          await deepenRemoteBranchHistory(activeLettaBranch, cwd);
          if (
            !(await branchContainsCommit(
              activeLettaBranch,
              checkoutBranch,
              cwd,
            ))
          ) {
            throw new Error(
              `Existing Letta branch "${activeLettaBranch}" does not contain the latest PR head. Rebase or delete that branch before rerunning.`,
            );
          }
        }
        await withCwd($`git checkout ${activeLettaBranch}`, cwd);
      } else {
        await withCwd($`git checkout -b ${lettaBranch}`, cwd);
      }

      setOutput("LETTA_BRANCH", activeLettaBranch);
      setOutput("BASE_BRANCH", baseBranch);
      return {
        baseBranch,
        lettaBranch: activeLettaBranch,
        currentBranch: activeLettaBranch,
      };
    }
  }

  // Determine source branch - use baseBranch if provided, otherwise fetch default
  let sourceBranch: string;

  if (baseBranch) {
    // Use provided base branch for source
    sourceBranch = baseBranch;
  } else {
    // No base branch provided, fetch the default branch to use as source
    const repoResponse = await octokits.rest.repos.get({
      owner,
      repo,
    });
    sourceBranch = repoResponse.data.default_branch;
  }

  // Generate branch name for either an issue or closed/merged PR
  const entityType = isPR ? "pr" : "issue";

  // Create Kubernetes-compatible timestamp: lowercase, hyphens only, shorter format
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  // Ensure branch name is Kubernetes-compatible:
  // - Lowercase only
  // - Alphanumeric with hyphens
  // - No underscores
  // - Max 50 chars (to allow for prefixes)
  const branchName = `${branchPrefix}${entityType}-${entityNumber}-${timestamp}`;
  const newBranch = branchName.toLowerCase().substring(0, 50);

  try {
    // Get the SHA of the source branch to verify it exists
    const sourceBranchRef = await octokits.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    const currentSHA = sourceBranchRef.data.object.sha;
    console.log(`Source branch SHA: ${currentSHA}`);

    // For commit signing, defer branch creation to the file ops server
    if (context.inputs.useCommitSigning) {
      console.log(
        `Branch name generated: ${newBranch} (will be created by file ops server on first commit)`,
      );

      // Ensure we're on the source branch
      console.log(`Fetching and checking out source branch: ${sourceBranch}`);
      await withCwd($`git fetch origin ${sourceBranch} --depth=1`, cwd);
      await withCwd($`git checkout ${sourceBranch}`, cwd);

      // Set outputs for GitHub Actions
      setOutput("LETTA_BRANCH", newBranch);
      setOutput("BASE_BRANCH", sourceBranch);
      return {
        baseBranch: sourceBranch,
        lettaBranch: newBranch,
        currentBranch: sourceBranch, // Stay on source branch for now
      };
    }

    // For non-signing case, create and checkout the branch locally only
    console.log(
      `Creating local branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );

    // Fetch and checkout the source branch first to ensure we branch from the correct base
    console.log(`Fetching and checking out source branch: ${sourceBranch}`);
    await withCwd($`git fetch origin ${sourceBranch} --depth=1`, cwd);
    await withCwd($`git checkout ${sourceBranch}`, cwd);

    // Create and checkout the new branch from the source branch
    await withCwd($`git checkout -b ${newBranch}`, cwd);

    console.log(
      `Successfully created and checked out local branch: ${newBranch}`,
    );

    // Set outputs for GitHub Actions
    setOutput("LETTA_BRANCH", newBranch);
    setOutput("BASE_BRANCH", sourceBranch);
    return {
      baseBranch: sourceBranch,
      lettaBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error in branch setup:", error);
    process.exit(1);
  }
}
