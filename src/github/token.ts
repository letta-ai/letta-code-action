#!/usr/bin/env bun

import * as core from "@actions/core";

/**
 * Setup GitHub token for the action.
 *
 * Letta Code Action requires a github_token to be provided. This can be:
 * 1. GITHUB_TOKEN (default Actions token) - comments as github-actions[bot]
 * 2. A token from actions/create-github-app-token - comments as your-app[bot]
 */
export async function setupGitHubToken(): Promise<string> {
  // Check if GitHub token was provided
  const providedToken = process.env.OVERRIDE_GITHUB_TOKEN;

  if (providedToken) {
    console.log("Using provided github_token for authentication");
    core.setOutput("GITHUB_TOKEN", providedToken);
    return providedToken;
  }

  // No token provided - fail with helpful message
  core.setFailed(
    `No github_token provided.

Letta Code Action requires a github_token to interact with GitHub.

Add this to your workflow:

  - uses: letta-ai/letta-code-action@v0
    with:
      letta_api_key: \${{ secrets.LETTA_API_KEY }}
      github_token: \${{ secrets.GITHUB_TOKEN }}

Or use a GitHub App for custom bot identity:

  - name: Generate GitHub App token
    id: app-token
    uses: actions/create-github-app-token@v1
    with:
      app-id: \${{ secrets.APP_ID }}
      private-key: \${{ secrets.APP_PRIVATE_KEY }}

  - uses: letta-ai/letta-code-action@v0
    with:
      letta_api_key: \${{ secrets.LETTA_API_KEY }}
      github_token: \${{ steps.app-token.outputs.token }}
`,
  );
  process.exit(1);
}
