import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as core from "@actions/core";
import {
  getPullRequestBranchPlan,
  setupBranch,
} from "../src/github/operations/branch";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitWithInput(cwd: string, args: string[], input: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    input,
  }).trim();
}

function createRemoteWithPullRef(options?: { reviewBranch?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "letta-branch-test-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const worktree = join(root, "worktree");

  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["init", seed], { stdio: "ignore" });
  git(seed, ["config", "user.email", "test@example.com"]);
  git(seed, ["config", "user.name", "Test User"]);

  writeFileSync(join(seed, "README.md"), "base\n");
  git(seed, ["add", "README.md"]);
  git(seed, ["commit", "-m", "initial"]);
  git(seed, ["branch", "-M", "main"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "origin", "main"]);

  git(seed, ["checkout", "-b", "feature"]);
  writeFileSync(join(seed, "feature.txt"), "feature\n");
  git(seed, ["add", "feature.txt"]);
  git(seed, ["commit", "-m", "feature"]);
  git(seed, ["push", "origin", "HEAD:refs/pull/37/head"]);

  if (options?.reviewBranch) {
    writeFileSync(join(seed, "feature.txt"), "review branch\n");
    writeFileSync(join(seed, "review.txt"), "existing review\n");
    git(seed, ["add", "feature.txt", "review.txt"]);
    git(seed, ["commit", "-m", "existing review branch"]);
    git(seed, ["push", "origin", "HEAD:refs/heads/letta/pr-37-review"]);
  }

  execFileSync("git", ["clone", "--branch", "main", remote, worktree], {
    stdio: "ignore",
  });

  return { root, worktree };
}

function createPullRequestData(isCrossRepository: boolean) {
  return {
    contextData: {
      state: "OPEN",
      baseRefName: "main",
      headRefName: "feature",
      isCrossRepository,
      commits: { totalCount: 1 },
    },
    changedFiles: [
      {
        path: "feature.txt",
        additions: 1,
        deletions: 0,
        changeType: "ADDED",
      },
    ],
    changedFilesWithSHA: [],
  } as any;
}

function createBranchContext() {
  return {
    repository: {
      owner: "owner",
      repo: "repo",
      full_name: "owner/repo",
    },
    entityNumber: 37,
    isPR: true,
    inputs: {
      baseBranch: "",
      branchPrefix: "letta/",
    },
  } as any;
}

describe("setupBranch", () => {
  test("uses a synthetic checkout and review branch for fork PRs", () => {
    expect(getPullRequestBranchPlan(37, "main", true, "letta/")).toEqual({
      fetchRef: "refs/pull/37/head",
      checkoutBranch: "letta-pr-37",
      lettaBranch: "letta/pr-37-review",
    });
  });

  test("keeps same-repo PR branch names for direct push behavior", () => {
    expect(
      getPullRequestBranchPlan(37, "add-morph-warpgrep", false, "letta/"),
    ).toEqual({
      fetchRef: "refs/pull/37/head",
      checkoutBranch: "add-morph-warpgrep",
    });
  });

  test("normalizes and truncates fork review branches", () => {
    expect(
      getPullRequestBranchPlan(
        123,
        "feature",
        true,
        "LETTA-REVIEW-BRANCH-WITH-A-LONG-PREFIX-",
      ).lettaBranch,
    ).toBe("letta-review-branch-with-a-long-prefix-pr-123-revi");
  });

  test("resets a same-repo PR branch even when it is already checked out", async () => {
    const { root, worktree } = createRemoteWithPullRef();
    const previousCwd = process.cwd();

    try {
      git(worktree, ["checkout", "-b", "feature"]);
      process.chdir(worktree);

      const result = await setupBranch(
        {} as any,
        createPullRequestData(false),
        createBranchContext(),
      );

      expect(result).toEqual({
        baseBranch: "main",
        currentBranch: "feature",
      });
      expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "feature",
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:feature.txt"])).toBe(
        "feature",
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reuses an existing remote Letta branch for fork PR follow-ups", async () => {
    const { root, worktree } = createRemoteWithPullRef({
      reviewBranch: true,
    });
    const previousCwd = process.cwd();
    const setOutputSpy = spyOn(core, "setOutput").mockImplementation(() => {});

    try {
      process.chdir(worktree);

      const githubData = createPullRequestData(true);
      const result = await setupBranch(
        {} as any,
        githubData,
        createBranchContext(),
      );

      expect(result).toEqual({
        baseBranch: "main",
        lettaBranch: "letta/pr-37-review",
        currentBranch: "letta/pr-37-review",
      });
      expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "letta/pr-37-review",
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:review.txt"])).toBe(
        "existing review",
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:feature.txt"])).toBe(
        "review branch",
      );
      expect(githubData.changedFilesWithSHA[0]?.sha).toBe(
        gitWithInput(worktree, ["hash-object", "--stdin"], "feature\n"),
      );
      expect(setOutputSpy).toHaveBeenCalledWith(
        "LETTA_BRANCH",
        "letta/pr-37-review",
      );
      expect(setOutputSpy).toHaveBeenCalledWith("BASE_BRANCH", "main");
    } finally {
      setOutputSpy.mockRestore();
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
