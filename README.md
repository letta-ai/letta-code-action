# Letta Code GitHub Action Integration

A GitHub Action that allows you to connect with Letta agents within your repository.

Mention `@letta-code` in any issue or PR to get help with code questions, implementation, and reviews.

> [!WARNING]
> The **Letta Code** GitHub Actions integration is currently experimental - expect breaking changes.
>
> Chat with our team by opening an issue/PR or joining [our Discord](https://discord.gg/letta).

## How does it work?

The `@letta-code` trigger uses the [Letta Code](https://github.com/letta-ai/letta-code) CLI harness (in headless mode) to "teleport" your Letta agents into a sandbox that has access to your GitHub repo.
Within the sandbox, the agent can do things like post comments (to GitHub), review code, and open branches / PRs.

By default, the `@letta-code` trigger will spawn a new agent on the first call within a context, and subsequent tags within the same context will route to the same agent.
This means that within a single GitHub issue for example, each time you tag the `@letta-code`, you're sending messages to the same agent.
If you would like to chat with an existing agent rather than spawning a new one, you can also use `@letta-code [--agent agent_id] ...` to invoke an existing agent specifically.

Because Letta agents are running on a server and are persisted indefinitely, you can easily access the agents on the [Agent Development Environment (ADE)](https://app.letta.com) web interface, or even "teleport" them into another CLI session (by starting Letta Code with the `letta --agent agent_id` flag).

## Quick Start

1. Get an API key from [app.letta.com](https://app.letta.com)
2. Add `LETTA_API_KEY` to your repository secrets
3. Create `.github/workflows/letta.yml`:

```yaml
name: Letta Code
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, assigned]
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
        with:
          fetch-depth: 1
      - uses: letta-ai/letta-code-action@v0
        with:
          letta_api_key: ${{ secrets.LETTA_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

That's it. Now mention `@letta-code` in any issue or PR comment.

### Using a Custom Bot Identity

To have comments appear as `your-app[bot]` instead of `github-actions[bot]`, use a GitHub App:

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

## How It Works

When you mention `@letta-code`, the action:

1. Creates a tracking comment showing the agent is working
2. Resumes the same agent if one was used before on this issue/PR (via metadata in comments)
3. Runs the agent with full access to read files, run commands, and make commits
4. Updates the comment with results and a link to view the agent in the [ADE](https://app.letta.com)

Each comment includes a footer with:

- Agent ID (click to open in Letta's Agent Development Environment)
- Model used
- Link to the job run
- Command to continue chatting in your terminal: `letta --agent <id>`

## Triggers

The action only runs when explicitly triggered. There are several ways to trigger it:

| Trigger      | How it works                                                              |
| ------------ | ------------------------------------------------------------------------- |
| **Mention**  | Include `@letta-code` in a comment, issue body, or PR body                |
| **Label**    | Add the `letta-code` label to an issue (configurable via `label_trigger`) |
| **Assignee** | Assign a specific user to an issue (configure via `assignee_trigger`)     |
| **Prompt**   | Set the `prompt` input for automated workflows (see below)                |

**Important:** Replying to a comment without `@letta-code` will _not_ trigger the action. Each interaction requires an explicit trigger.

### Automated Mode

For workflows that should run automatically (e.g., auto-review every PR), use the `prompt` input:

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

## Agent Persistence

The agent ID is stored in a hidden HTML comment in the tracking comment. On follow-up mentions, the action finds this metadata and resumes the same agent, preserving conversation history and memory.

To force a new agent, use the bracket syntax: `@letta-code [--new] start fresh`

## Configuration

| Input                     | Description                                                | Default       |
| ------------------------- | ---------------------------------------------------------- | ------------- |
| `letta_api_key`           | Your Letta API key                                         | Required      |
| `github_token`            | GitHub token for API access                                | Required      |
| `prompt`                  | Auto-trigger with this prompt (for automated workflows)    | None          |
| `trigger_phrase`          | Phrase that activates the agent                            | `@letta-code` |
| `model`                   | Model to use (`opus`, `sonnet-4.5`, `haiku`, `gpt-4.1`)    | `opus`        |
| `assignee_trigger`        | Username that triggers when assigned (e.g., `letta-bot`)   | None          |
| `label_trigger`           | Label that triggers the action                             | `letta-code`  |
| `allowed_bots`            | Comma-separated bot usernames allowed to trigger (or `*`)  | None          |
| `allowed_non_write_users` | Users allowed without write permissions (use with caution) | None          |

## Bracket Syntax

Pass arguments to the Letta CLI directly from your comment:

```
@letta-code [--model haiku] quick question about this code
@letta-code [--new] start with a fresh agent
@letta-code [--new --model sonnet-4.5] new agent with a specific model
```

Multiple flags can be combined in a single bracket. The brackets are parsed and removed from the prompt before it reaches the agent.

## Examples

**Ask a question:**

```
@letta-code what does the `processPayment` function do?
```

**Request implementation:**

```
@letta-code add input validation to the signup form. Check for valid email format and password length >= 8.
```

**Code review:**

```
@letta-code review this PR for potential security issues
```

**Continue a conversation:**

```
@letta-code actually, also add a confirm password field
```

(Uses the same agent from the previous mention, so it remembers the context)

## CLI Companion

You can continue chatting with the same agent locally using [Letta Code](https://github.com/letta-ai/letta-code):

```bash
# Install
npm install -g @letta-ai/letta-code

# Resume the agent from GitHub
letta --agent agent-xxxxx
```

The agent ID is shown in every GitHub comment footer.

## What Can It Do?

- Read and search files in your repository
- Make edits and create new files
- Run shell commands (git, npm, etc.)
- Commit and push changes
- Create pull requests
- Update its tracking comment with progress

## What Can't It Do?

- Approve PRs (security restriction)
- Modify workflow files (GitHub doesn't allow this)

## Security

**By default, only repository collaborators with write access can trigger the action.** This prevents random users on public repos from consuming your API credits.

| Input                     | Description                                                                     | Default |
| ------------------------- | ------------------------------------------------------------------------------- | ------- |
| `allowed_bots`            | Comma-separated bot usernames (or `*` for all) that can trigger the action      | None    |
| `allowed_non_write_users` | Comma-separated usernames to allow without write permissions (use with caution) | None    |

The action checks permissions via the GitHub API before running. If a user without write access tries to trigger `@letta-code`, the action will fail with "Actor does not have write permissions to the repository".

## Troubleshooting

**Agent not responding?**

- Check that `LETTA_API_KEY` is set in repository secrets
- Verify the workflow has the required permissions
- Look at the Actions tab for error logs

**Wrong agent resumed?**

- The agent ID is determined by metadata in previous comments
- Use `@letta-code [--new]` to force a fresh agent

**Want to see what the agent is doing?**

- Click "View job run" in the comment footer
- Enable `show_full_output: true` in your workflow for detailed logs
