# Letta Code GitHub Action

![Letta Code](https://raw.githubusercontent.com/letta-ai/letta-code-action/main/docs/letta-logo.jpg)

A GitHub Action that brings stateful AI coding agents to your repository. Mention `@letta-code` in any issue or PR to get help with code questions, implementation, and reviews.

> [!WARNING]
> The **Letta Code** GitHub Action is experimental - expect breaking changes.
>
> Chat with our team by opening an issue/PR or joining [our Discord](https://discord.gg/letta).

## Quick Start

1. Get an API key from [app.letta.com](https://app.letta.com)
2. Add `LETTA_API_KEY` to your repository secrets
3. Create `.github/workflows/letta.yml`:

### Using an existing agent

If you already have a Letta agent (created via the [ADE](https://app.letta.com) or CLI), configure its ID:

```yaml
name: Letta Code

on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, labeled]
  pull_request_review_comment:
    types: [created]

jobs:
  letta:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: letta-ai/letta-code-action@v0
        with:
          letta_api_key: ${{ secrets.LETTA_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          agent_id: ${{ vars.LETTA_AGENT_ID }}
```

> **Note:** Store your agent ID as a [repository variable](https://docs.github.com/en/actions/learn-github-actions/variables) at Settings → Secrets and variables → Actions → Variables.

### Creating a new agent

If you don't have an agent yet, omit the `agent_id` and the action will create one automatically:

```yaml
name: Letta Code

on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, labeled]
  pull_request_review_comment:
    types: [created]

jobs:
  letta:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: letta-ai/letta-code-action@v0
        with:
          letta_api_key: ${{ secrets.LETTA_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

The agent ID will be shown in the comment footer. You can then add it to your workflow to reuse the same agent.

That's it! Now mention `@letta-code` in any issue or PR comment.

## How It Works

When you mention `@letta-code`, the action:

1. Creates a tracking comment showing the agent is working
2. Resumes the same conversation if one exists for this issue/PR
3. Runs the agent with full access to read files, run commands, and make commits
4. Updates the comment with results and links to continue the conversation

Each response includes a footer like:

```
🤖 Agent: Memo • View job run
💻 Chat with this agent in your terminal: letta --conv conv-abc123
```

Click the agent name to open the conversation in the [Letta ADE](https://app.letta.com).

## Conversations

The action uses persistent conversations to maintain context across interactions.

### Issue Conversations

Each issue gets its own conversation, labeled as `owner/repo/issue-N`. When you mention `@letta-code` multiple times in the same issue, the agent remembers the full context.

### PR Conversations

PRs can either:

- **Start a new conversation** if the PR doesn't reference an issue
- **Continue an issue's conversation** if the PR references an issue (via "Fixes #N", "Closes #N", etc.)

This means when you create a PR that fixes an issue, the agent already has the full context from the issue discussion.

### Starting Fresh

To force a new conversation, use: `@letta-code [--new] start fresh`

This creates a new conversation while keeping the same agent (preserving its memory and learned preferences).

## Configuration

| Input                      | Description                                                | Default       |
| -------------------------- | ---------------------------------------------------------- | ------------- |
| `letta_api_key`            | Your Letta API key                                         | Required      |
| `github_token`             | GitHub token for API access                                | Required      |
| `agent_id`                 | Specific agent ID to use (auto-discovers if not set)       | None          |
| `model`                    | Model to use (`opus`, `sonnet-4.5`, `haiku`, `gpt-4.1`)    | `opus`        |
| `prompt`                   | Auto-trigger with this prompt (for automated workflows)    | None          |
| `trigger_phrase`           | Phrase that activates the agent                            | `@letta-code` |
| `label_trigger`            | Label that triggers the action                             | `letta-code`  |
| `assignee_trigger`         | Username that triggers when assigned                       | None          |
| `path_to_letta_executable` | Path to a custom Letta Code CLI                            | None          |
| `allowed_bots`             | Comma-separated bot usernames allowed to trigger (or `*`)  | None          |
| `allowed_non_write_users`  | Users allowed without write permissions (use with caution) | None          |

### Using a Specific Agent

To use the same agent across all issues and PRs:

```yaml
- uses: letta-ai/letta-code-action@v0
  with:
    letta_api_key: ${{ secrets.LETTA_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
    agent_id: agent-586a9276-1e95-41f8-aaa4-0fb224398a01
```

This gives you:

- **Shared memory**: The agent learns across all repository interactions
- **Consistent behavior**: Same configuration and preferences everywhere
- **Centralized management**: Update the agent once, all workflows use it

### Using the Latest CLI

To ensure you're using the latest Letta Code CLI:

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Install latest Letta Code
    id: letta-bin
    run: |
      npm install -g @letta-ai/letta-code@latest
      echo "path=$(command -v letta)" >> "$GITHUB_OUTPUT"

  - uses: letta-ai/letta-code-action@v0
    with:
      letta_api_key: ${{ secrets.LETTA_API_KEY }}
      github_token: ${{ secrets.GITHUB_TOKEN }}
      path_to_letta_executable: ${{ steps.letta-bin.outputs.path }}
```

## Triggers

| Trigger      | How it works                                                          |
| ------------ | --------------------------------------------------------------------- |
| **Mention**  | Include `@letta-code` in a comment, issue body, or PR body            |
| **Label**    | Add the `letta-code` label to an issue or PR                          |
| **Assignee** | Assign a specific user to an issue (configure via `assignee_trigger`) |
| **Prompt**   | Set the `prompt` input for automated workflows                        |

Replying to a comment without `@letta-code` will _not_ trigger the action.

### Automated Workflows

For workflows that run automatically (e.g., auto-review every PR):

```yaml
on:
  pull_request:
    types: [opened]

jobs:
  auto-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: letta-ai/letta-code-action@v0
        with:
          letta_api_key: ${{ secrets.LETTA_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          prompt: "Review this PR for bugs and security issues"
```

## Bracket Syntax

Pass arguments directly from your comment:

```
@letta-code [--agent agent-xxx] use a specific agent
@letta-code [--new] start a fresh conversation
@letta-code [--agent agent-xxx --new] new conversation on a specific agent
```

## CLI Companion

Continue the conversation locally using [Letta Code](https://github.com/letta-ai/letta-code):

```bash
# Install
npm install -g @letta-ai/letta-code

# Resume the conversation from GitHub
letta --conv conv-xxxxx

# Or start a new conversation with the same agent
letta --agent agent-xxxxx --new
```

The conversation ID and agent ID are shown in every GitHub comment footer.

## Custom Bot Identity

To have comments appear as `your-app[bot]` instead of `github-actions[bot]`:

```yaml
steps:
  - uses: actions/checkout@v4
  - name: Generate GitHub App token
    id: app-token
    uses: actions/create-github-app-token@v1
    with:
      app-id: ${{ secrets.APP_ID }}
      private-key: ${{ secrets.APP_PRIVATE_KEY }}
  - uses: letta-ai/letta-code-action@v0
    with:
      letta_api_key: ${{ secrets.LETTA_API_KEY }}
      github_token: ${{ steps.app-token.outputs.token }}
```

## Capabilities

**What it can do:**

- Read and search files in your repository
- Make edits and create new files
- Run shell commands (git, npm, etc.)
- Commit and push changes
- Create pull requests
- Update its tracking comment with progress

**What it can't do:**

- Approve PRs (security restriction)
- Modify workflow files (GitHub restriction)

## Security

By default, only repository collaborators with write access can trigger the action. This prevents unauthorized users from consuming your API credits.

Use `allowed_bots` for bot users or `allowed_non_write_users` to allow specific usernames without write permissions (use with caution).

## Troubleshooting

**Agent not responding?**

- Check that `LETTA_API_KEY` is set in repository secrets
- Verify the workflow has the required permissions
- Look at the Actions tab for error logs

**Wrong conversation resumed?**

- Use `@letta-code [--new]` to start a fresh conversation

**Want to see what the agent is doing?**

- Click "View job run" in the comment footer
- Enable `show_full_output: true` in your workflow for detailed logs
