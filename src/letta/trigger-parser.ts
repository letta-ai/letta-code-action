/**
 * Parses @letta trigger comments for CLI arguments
 *
 * Syntax: @letta [--flag value --other-flag] the actual prompt
 *
 * Examples:
 *   @letta [--model haiku] fix this bug
 *   @letta [--agent agent-xxx] continue working
 *   @letta [--new --model opus-4.1] start fresh
 */

import type { ParsedGitHubContext } from "../github/context";

export interface ParsedTrigger {
  /** Args to pass to letta CLI */
  lettaArgs: string[];
  /** The actual request (everything after brackets, or full text if no brackets) */
  prompt: string;
  /** Warnings for blocked/ignored flags */
  warnings: string[];
  /** Whether parsing encountered an error (e.g., unclosed bracket) */
  parseError: string | null;
}

/** Flags we control - these get stripped with a warning */
const BLOCKED_FLAGS = new Set([
  "-p",
  "--prompt",
  "--output-format",
  "--yolo",
  "-y",
]);

/** Flags that take a value (need to skip the next token too) */
const FLAGS_WITH_VALUES = new Set([
  "-p",
  "--prompt",
  "-m",
  "--model",
  "--agent",
  "--output-format",
]);

/**
 * Parse a trigger comment for @letta [...] syntax
 */
export function parseTrigger(
  triggerPhrase: string,
  commentBody: string,
): ParsedTrigger {
  const result: ParsedTrigger = {
    lettaArgs: [],
    prompt: "",
    warnings: [],
    parseError: null,
  };

  // Find the trigger phrase
  const triggerIndex = commentBody
    .toLowerCase()
    .indexOf(triggerPhrase.toLowerCase());
  if (triggerIndex === -1) {
    result.prompt = commentBody;
    return result;
  }

  // Get everything after the trigger phrase
  const afterTrigger = commentBody.slice(triggerIndex + triggerPhrase.length);

  // Check for bracket syntax
  const bracketMatch = afterTrigger.match(/^\s*\[([^\]]*)\]?\s*([\s\S]*)/);

  if (!bracketMatch) {
    // No brackets - entire thing after trigger is the prompt
    result.prompt = afterTrigger.trim();
    return result;
  }

  const bracketContent = bracketMatch[1] || "";
  const restOfComment = bracketMatch[2] || "";

  // Check for unclosed bracket
  if (!afterTrigger.includes("]") && bracketContent) {
    result.parseError = "Unclosed bracket in trigger syntax";
    result.prompt = afterTrigger.trim();
    return result;
  }

  // Empty brackets - just use the rest as prompt
  if (!bracketContent.trim()) {
    result.prompt = restOfComment.trim();
    return result;
  }

  // Parse the bracket content into args
  const args = parseArgs(bracketContent);
  const filteredArgs: string[] = [];
  const blockedFound: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg) {
      i += 1;
      continue;
    }

    if (BLOCKED_FLAGS.has(arg)) {
      blockedFound.push(arg);
      // Skip the value too if this flag takes one
      if (FLAGS_WITH_VALUES.has(arg) && i + 1 < args.length) {
        i += 2;
      } else {
        i += 1;
      }
    } else {
      filteredArgs.push(arg);
      i += 1;
    }
  }

  if (blockedFound.length > 0) {
    result.warnings.push(`Ignored flags: ${blockedFound.join(", ")}`);
  }

  result.lettaArgs = filteredArgs;
  result.prompt = restOfComment.trim();

  return result;
}

/**
 * Simple arg parser - splits on whitespace, respects quotes
 */
function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Format warnings for display in a comment
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return "";
  return `> **Note:** ${warnings.join(". ")}\n\n`;
}

/**
 * Extract the content that triggered the action from context
 */
export function getTriggerContent(context: ParsedGitHubContext): string {
  const payload = context.payload as Record<string, unknown>;

  // Comment triggers (most common for bracket syntax)
  if (
    context.eventName === "issue_comment" ||
    context.eventName === "pull_request_review_comment"
  ) {
    const comment = payload.comment as { body?: string } | undefined;
    return comment?.body || "";
  }

  // PR review body
  if (context.eventName === "pull_request_review") {
    const review = payload.review as { body?: string } | undefined;
    return review?.body || "";
  }

  // Issue body (on issue creation)
  if (context.eventName === "issues") {
    const issue = payload.issue as { body?: string } | undefined;
    return issue?.body || "";
  }

  // PR body
  if (
    context.eventName === "pull_request" ||
    context.eventName === "pull_request_target"
  ) {
    const pr = payload.pull_request as { body?: string } | undefined;
    return pr?.body || "";
  }

  return "";
}

/**
 * Parse trigger from context - convenience wrapper
 */
export function parseTriggerFromContext(
  context: ParsedGitHubContext,
): ParsedTrigger {
  const triggerPhrase = context.inputs.triggerPhrase;
  const content = getTriggerContent(context);
  return parseTrigger(triggerPhrase, content);
}
