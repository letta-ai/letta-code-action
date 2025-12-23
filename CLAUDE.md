# CLAUDE.md

Guidance for AI coding assistants (including Letta Code) working on this repository.

## Development

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)

```bash
bun run install-hooks # Install pre-commit hooks (run once after clone)
bun test              # Run tests
bun run format        # Format with prettier
bun run typecheck     # TypeScript check
```

The pre-commit hook runs prettier, typecheck, and tests before each commit.

## What This Is

A GitHub Action that adds a stateful Letta agent to repositories. Users mention `@letta-code` in issues/PRs to interact with the agent.

Key difference from similar tools: **agent persistence**. The same agent resumes across multiple mentions on the same issue/PR, preserving memory and context.

## Architecture

```
src/
├── entrypoints/         # Action entry points
│   ├── prepare.ts       # Setup: auth, permissions, context
│   └── update-comment-link.ts  # Post-execution comment updates
├── github/              # GitHub API integration
│   ├── data/            # Fetch PR/issue data
│   ├── operations/      # Branch, comment, git operations
│   └── validation/      # Permission checks
├── modes/               # Execution modes
│   └── tag/             # @letta-code mention handling
├── letta/               # Letta-specific logic
│   ├── find-existing-agent.ts  # Agent persistence
│   ├── metadata.ts      # Comment metadata parsing
│   └── trigger-parser.ts  # Bracket syntax parsing
└── create-prompt/       # Prompt generation

src/runner/              # Letta CLI execution
    ├── index.ts         # Entry point
    ├── run-letta.ts     # CLI execution
    ├── prepare-prompt.ts
    └── validate-env.ts
```

## Key Concepts

### Agent Persistence

Agent ID stored in HTML comment metadata within the tracking comment. On follow-up triggers, this ID is extracted and passed to `letta --agent <id>` to resume the same agent.

### Skills (not MCP)

Letta uses Skills instead of MCP servers. The `github-action` skill teaches the agent to use `gh` CLI for comment updates and git commands.

### Bracket Syntax

Users can pass CLI args: `@letta-code [--model haiku] question here`
Parsed in `src/letta/trigger-parser.ts`, blocked flags filtered out.

## Code Style

- No MCP code (deleted)
- Use `gh` CLI for GitHub operations in prompts
- Agent ID in comment footer links to ADE
- Tests use `bun:test`
