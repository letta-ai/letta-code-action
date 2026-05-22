import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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

function createOutputCollector() {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    setOutput: (name: string, value: string) => {
      calls.push([name, value]);
    },
  };
}

function createRemoteWithPullRef(options?: {
  reviewBranch?: boolean;
  reviewBranchName?: string;
  reviewBranchExtraCommits?: number;
  advancePullRefAfterReviewBranch?: boolean;
  nestedReviewBranchOnly?: boolean;
}) {
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
  const featureHead = git(seed, ["rev-parse", "HEAD"]);
  git(seed, ["push", "origin", "HEAD:refs/pull/37/head"]);

  if (options?.reviewBranch || options?.reviewBranchName) {
    const reviewBranchName = options.reviewBranchName ?? "letta/pr-37-review";
    writeFileSync(join(seed, "feature.txt"), "review branch\n");
    writeFileSync(join(seed, "review.txt"), "existing review\n");
    git(seed, ["add", "feature.txt", "review.txt"]);
    git(seed, ["commit", "-m", "existing review branch"]);
    for (let i = 1; i <= (options.reviewBranchExtraCommits ?? 0); i++) {
      writeFileSync(join(seed, `review-${i}.txt`), `review ${i}\n`);
      git(seed, ["add", `review-${i}.txt`]);
      git(seed, ["commit", "-m", `review update ${i}`]);
    }
    git(seed, ["push", "origin", `HEAD:refs/heads/${reviewBranchName}`]);
  }

  if (options?.advancePullRefAfterReviewBranch) {
    git(seed, ["reset", "--hard", featureHead]);
    writeFileSync(join(seed, "updated.txt"), "updated PR head\n");
    git(seed, ["add", "updated.txt"]);
    git(seed, ["commit", "-m", "advance pull ref"]);
    git(seed, ["push", "origin", "HEAD:refs/pull/37/head"]);
  }

  if (options?.nestedReviewBranchOnly) {
    git(seed, ["push", "origin", "HEAD:refs/heads/foo/letta/pr-37-review"]);
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

function createBranchContextWithPrefix(branchPrefix: string) {
  return {
    ...createBranchContext(),
    inputs: {
      baseBranch: "",
      branchPrefix,
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
      ),
    ).toMatchObject({
      lettaBranch: "letta-review-branch-with-a-long-pr-123-review",
      legacyLettaBranch: "letta-review-branch-with-a-long-prefix-pr-123-revi",
    });
  });

  test("resets a same-repo PR branch even when it is already checked out", async () => {
    const { root, worktree } = createRemoteWithPullRef();

    try {
      git(worktree, ["checkout", "-b", "feature"]);
      const result = await setupBranch(
        {} as any,
        createPullRequestData(false),
        createBranchContext(),
        { cwd: worktree },
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
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reuses an existing remote Letta branch for fork PR follow-ups", async () => {
    const { root, worktree } = createRemoteWithPullRef({
      reviewBranch: true,
    });

    try {
      const githubData = createPullRequestData(true);
      const outputs = createOutputCollector();
      const result = await setupBranch(
        {} as any,
        githubData,
        createBranchContext(),
        { cwd: worktree, setOutput: outputs.setOutput },
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
      expect(outputs.calls).toContainEqual([
        "LETTA_BRANCH",
        "letta/pr-37-review",
      ]);
      expect(outputs.calls).toContainEqual(["BASE_BRANCH", "main"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reuses legacy truncated Letta branch names for fork PR follow-ups", async () => {
    const branchPrefix = "LETTA-REVIEW-BRANCH-WITH-A-LONG-PREFIX-";
    const legacyLettaBranch = getPullRequestBranchPlan(
      37,
      "feature",
      true,
      branchPrefix,
    ).legacyLettaBranch;
    expect(legacyLettaBranch).toBe(
      "letta-review-branch-with-a-long-prefix-pr-37-revie",
    );
    if (!legacyLettaBranch) {
      throw new Error("Expected a legacy branch fallback");
    }
    const { root, worktree } = createRemoteWithPullRef({
      reviewBranchName: legacyLettaBranch,
    });

    try {
      const outputs = createOutputCollector();
      const result = await setupBranch(
        {} as any,
        createPullRequestData(true),
        createBranchContextWithPrefix(branchPrefix),
        { cwd: worktree, setOutput: outputs.setOutput },
      );

      expect(result).toEqual({
        baseBranch: "main",
        lettaBranch: legacyLettaBranch,
        currentBranch: legacyLettaBranch,
      });
      expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        legacyLettaBranch,
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:review.txt"])).toBe(
        "existing review",
      );
      expect(outputs.calls).toContainEqual(["LETTA_BRANCH", legacyLettaBranch]);
      expect(outputs.calls).toContainEqual(["BASE_BRANCH", "main"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("deepens long-lived Letta branches before stale branch rejection", async () => {
    const { root, worktree } = createRemoteWithPullRef({
      reviewBranch: true,
      reviewBranchExtraCommits: 25,
    });

    try {
      const result = await setupBranch(
        {} as any,
        createPullRequestData(true),
        createBranchContext(),
        { cwd: worktree, setOutput: createOutputCollector().setOutput },
      );

      expect(result).toEqual({
        baseBranch: "main",
        lettaBranch: "letta/pr-37-review",
        currentBranch: "letta/pr-37-review",
      });
      expect(git(worktree, ["cat-file", "-p", "HEAD:feature.txt"])).toBe(
        "review branch",
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:review-25.txt"])).toBe(
        "review 25",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects stale remote Letta branches that miss the latest fork PR head", async () => {
    const { root, worktree } = createRemoteWithPullRef({
      reviewBranch: true,
      advancePullRefAfterReviewBranch: true,
    });

    try {
      await expect(
        setupBranch(
          {} as any,
          createPullRequestData(true),
          createBranchContext(),
          { cwd: worktree, setOutput: createOutputCollector().setOutput },
        ),
      ).rejects.toThrow("does not contain the latest PR head");
      expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "letta-pr-37",
      );
      expect(git(worktree, ["cat-file", "-p", "HEAD:updated.txt"])).toBe(
        "updated PR head",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not treat nested remote branch suffix matches as exact review branches", async () => {
    const { root, worktree } = createRemoteWithPullRef({
      nestedReviewBranchOnly: true,
    });

    try {
      const result = await setupBranch(
        {} as any,
        createPullRequestData(true),
        createBranchContext(),
        { cwd: worktree, setOutput: createOutputCollector().setOutput },
      );

      expect(result).toEqual({
        baseBranch: "main",
        lettaBranch: "letta/pr-37-review",
        currentBranch: "letta/pr-37-review",
      });
      expect(git(worktree, ["cat-file", "-p", "HEAD:feature.txt"])).toBe(
        "feature",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects invalid generated review branch names before reuse fetches", async () => {
    const { root, worktree } = createRemoteWithPullRef();

    try {
      await expect(
        setupBranch(
          {} as any,
          createPullRequestData(true),
          createBranchContextWithPrefix("bad*prefix/"),
          { cwd: worktree },
        ),
      ).rejects.toThrow("Invalid generated branch name");
      expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
