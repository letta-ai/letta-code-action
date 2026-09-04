import * as core from "@actions/core";
import { exec } from "child_process";
import { promisify } from "util";
import { unlink, writeFile, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { spawn } from "child_process";
import { parse as parseShellArgs } from "shell-quote";
import {
  updateConversationSummary,
  buildConversationSummary,
  getLatestConversation,
  getAgentInfo,
} from "../letta/client";

const execAsync = promisify(exec);

const PIPE_PATH = `${process.env.RUNNER_TEMP}/letta_prompt_pipe`;
const EXECUTION_FILE = `${process.env.RUNNER_TEMP}/letta-execution-output.json`;
const AGENT_INFO_FILE = `${process.env.RUNNER_TEMP}/letta-agent-info.json`;
const BASE_ARGS = ["--output-format", "stream-json"];

// ADE (Agent Development Environment) URL
const ADE_BASE_URL = "https://app.letta.com/agents";

/**
 * Update the GitHub comment with agent info when we get the init event
 */
async function updateCommentWithAgentInfo(
  agentId: string,
  conversationId?: string,
) {
  const commentId = process.env.LETTA_COMMENT_ID;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";

  if (!commentId || !repo) {
    console.log(
      "Skipping comment update - missing LETTA_COMMENT_ID or GITHUB_REPOSITORY",
    );
    return;
  }

  // Fetch agent name (fall back to ID if unavailable)
  let agentDisplayName = agentId;
  try {
    const agentInfo = await getAgentInfo(agentId);
    if (agentInfo?.name) {
      agentDisplayName = agentInfo.name;
    }
  } catch (error) {
    console.warn("Failed to fetch agent name, using ID:", error);
  }

  const adeBaseLink = `${ADE_BASE_URL}/${agentId}`;
  const adeLink = conversationId
    ? `${adeBaseLink}?conversation=${conversationId}`
    : adeBaseLink;
  const jobLink = `${serverUrl}/${repo}/actions/runs/${runId}`;

  // Build CLI command - use --conv if conversation_id available, otherwise --agent
  const cliCommand = conversationId
    ? `letta --conv ${conversationId}`
    : `letta --agent ${agentId}`;

  const body = `Letta Code is working… <img src="https://github.com/user-attachments/assets/05be199b-c834-407f-8371-6f4b91435b71" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />

---
🤖 **Agent:** [${agentDisplayName}](${adeLink}) • [View job run](${jobLink})
💻 Chat with this agent in your terminal using [Letta Code](https://github.com/letta-ai/letta-code): \`${cliCommand}\``;

  try {
    await execAsync(
      `gh api /repos/${repo}/issues/comments/${commentId} -X PATCH -f body='${body.replace(/'/g, "'\\''")}'`,
    );
    console.log(
      `Updated comment with agent info: ${agentDisplayName} (${agentId})${conversationId ? `, conversation: ${conversationId}` : ""}`,
    );
  } catch (error) {
    console.error("Failed to update comment with agent info:", error);
    // Don't fail the run if comment update fails
  }
}

/**
 * Sanitizes JSON output to remove sensitive information when full output is disabled
 * Returns a safe summary message or null if the message should be completely suppressed
 */
export function sanitizeJsonOutput(
  jsonObj: any,
  showFullOutput: boolean,
): string | null {
  if (showFullOutput) {
    return JSON.stringify(jsonObj, null, 2);
  }

  const type = jsonObj.type;

  // Init event - safe to show
  if (type === "init") {
    return JSON.stringify(
      {
        type: "init",
        message: "Letta Code initialized",
        agent_id: jsonObj.agent_id,
        model: jsonObj.model || "unknown",
      },
      null,
      2,
    );
  }

  // Result messages - Always show the final result
  if (type === "result") {
    return JSON.stringify(
      {
        type: "result",
        subtype: jsonObj.subtype,
        is_error: jsonObj.is_error,
        duration_ms: jsonObj.duration_ms,
        num_turns: jsonObj.num_turns,
        agent_id: jsonObj.agent_id,
        usage: jsonObj.usage,
      },
      null,
      2,
    );
  }

  // For any other message types, suppress in non-full-output mode
  return null;
}

export type LettaOptions = {
  lettaArgs?: string;
  model?: string;
  agentId?: string;
  conversationId?: string;
  createNewConversation?: boolean;
  pathToLettaExecutable?: string;
  showFullOutput?: string;
  environment?: string;
};

type PreparedConfig = {
  lettaArgs: string[];
  promptPath: string;
  env: Record<string, string>;
};

export type LettaFailure = {
  stage: string;
  code: string;
  message: string;
  http_status: number | null;
  retryable: boolean;
};

type JsonRecord = Record<string, unknown>;

const FAILURE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FAILURE_IDENTIFIER_MAX_LENGTH = 128;
const FAILURE_MESSAGE_MAX_LENGTH = 512;
const FAILURE_KEYS = new Set([
  "stage",
  "code",
  "message",
  "http_status",
  "retryable",
  "client_message_ids",
]);

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse all NDJSON records from the complete accumulated process output. */
export function parseNdjsonOutput(output: string): JsonRecord[] {
  const records: JsonRecord[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    try {
      const parsed: unknown = JSON.parse(line);
      if (isJsonRecord(parsed)) records.push(parsed);
    } catch {
      // Non-JSON output must never be used in a failure summary.
    }
  }

  return records;
}

/** Find the final result envelope in complete accumulated stream-json output. */
export function findLastResult(output: string): JsonRecord | null {
  let lastResult: JsonRecord | null = null;

  for (const record of parseNdjsonOutput(output)) {
    if (record.type === "result") lastResult = record;
  }

  return lastResult;
}

/** Strictly validate and sanitize the public failure fields from a result. */
export function validateFailure(value: unknown): LettaFailure | null {
  if (!isJsonRecord(value)) return null;
  if (Object.keys(value).some((key) => !FAILURE_KEYS.has(key))) return null;

  const { stage, code, message, http_status: httpStatus, retryable } = value;
  const validIdentifier = (field: unknown): field is string =>
    typeof field === "string" &&
    field.length <= FAILURE_IDENTIFIER_MAX_LENGTH &&
    FAILURE_IDENTIFIER_PATTERN.test(field);

  if (!validIdentifier(stage) || !validIdentifier(code)) return null;
  if (typeof message !== "string" || typeof retryable !== "boolean") {
    return null;
  }
  if (
    httpStatus !== null &&
    (typeof httpStatus !== "number" ||
      !Number.isInteger(httpStatus) ||
      httpStatus < 100 ||
      httpStatus > 599)
  ) {
    return null;
  }
  const clientMessageIds = value.client_message_ids;
  if (
    !Array.isArray(clientMessageIds) ||
    clientMessageIds.length > 32 ||
    clientMessageIds.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 256,
    )
  ) {
    return null;
  }

  const safeMessage = Array.from(message, (character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
      ? " "
      : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FAILURE_MESSAGE_MAX_LENGTH);
  if (!safeMessage) return null;

  return {
    stage,
    code,
    message: safeMessage,
    http_status: httpStatus,
    retryable,
  };
}

export function formatFailureSummary(failure: LettaFailure): string {
  const httpStatus =
    failure.http_status === null ? "" : ` (HTTP ${failure.http_status})`;
  return `Letta Code failed at ${failure.stage} [${failure.code}]${httpStatus}: ${failure.message} (retryable: ${failure.retryable})`;
}

export function prepareRunConfig(
  promptPath: string,
  options: LettaOptions,
): PreparedConfig {
  // Build Letta CLI arguments:
  // 1. Parse custom args first to detect conflicts
  // 2. Conversation/Agent flags for resumption (with conflict handling)
  // 3. Model flag if specified
  // 4. Environment flag if specified
  // 5. Prompt flag
  // 6. Remaining user's custom args
  // 7. BASE_ARGS (always last)

  const lettaArgs: string[] = [];

  // Parse custom args FIRST to detect --agent conflict
  // This handles the case where user provides [--agent <id>] in bracket syntax
  // while an existing conversation exists
  let customArgs: string[] = [];
  let userRequestedAgentId: string | undefined;
  let userRequestedNew = false;

  if (options.lettaArgs?.trim()) {
    const parsed = parseShellArgs(options.lettaArgs);
    const allCustomArgs = parsed.filter(
      (arg): arg is string => typeof arg === "string",
    );

    // Extract --agent/-a and --new flags from custom args to handle conflicts
    let i = 0;
    while (i < allCustomArgs.length) {
      if (
        (allCustomArgs[i] === "--agent" || allCustomArgs[i] === "-a") &&
        i + 1 < allCustomArgs.length
      ) {
        userRequestedAgentId = allCustomArgs[i + 1];
        i += 2; // Skip both --agent and its value
      } else if (allCustomArgs[i] === "--new") {
        userRequestedNew = true;
        i += 1;
      } else {
        customArgs.push(allCustomArgs[i]!);
        i++;
      }
    }
  }

  // Handle conversation/agent resumption with conflict detection:
  // - User's --agent flag in bracket syntax takes priority over existing conversation
  // - This allows users to explicitly switch agents mid-issue/PR
  if (userRequestedAgentId) {
    // User explicitly requested a specific agent via bracket syntax
    if (options.conversationId) {
      console.log(
        `User requested agent ${userRequestedAgentId} via bracket syntax, ` +
          `ignoring existing conversation ${options.conversationId}`,
      );
    }
    // Always use --new when user specifies --agent to start fresh conversation
    lettaArgs.push("--agent", userRequestedAgentId, "--new");
  } else if (userRequestedNew) {
    // User explicitly requested --new to start fresh
    if (options.agentId) {
      // Has an agent - start fresh conversation on it
      lettaArgs.push("--agent", options.agentId, "--new");
    } else {
      // No agent - just use --new to create new agent
      lettaArgs.push("--new");
    }
  } else if (options.conversationId) {
    // No user override - resume existing conversation
    // Use --conversation (not --conv alias) for compatibility with older CLI versions
    lettaArgs.push("--conversation", options.conversationId);
  } else if (options.agentId && options.createNewConversation) {
    lettaArgs.push("--agent", options.agentId, "--new");
  } else if (options.agentId) {
    lettaArgs.push("--agent", options.agentId);
  } else if (options.createNewConversation) {
    lettaArgs.push("--new");
  }

  // Model selection
  if (options.model) {
    lettaArgs.push("-m", options.model);
  }

  // YOLO mode - auto-approve all tool calls in headless mode
  // This is required for CI where there's no human to approve
  lettaArgs.push("--yolo");

  if (options.environment?.trim()) {
    lettaArgs.push("--environment", options.environment.trim());
  }

  // Prompt flag
  lettaArgs.push("-p");

  // Add remaining custom arguments (with --agent and --new already extracted)
  lettaArgs.push(...customArgs);

  // BASE_ARGS are always appended last
  lettaArgs.push(...BASE_ARGS);

  const customEnv: Record<string, string> = {};

  if (process.env.INPUT_ACTION_INPUTS_PRESENT) {
    customEnv.GITHUB_ACTION_INPUTS = process.env.INPUT_ACTION_INPUTS_PRESENT;
  }

  return {
    lettaArgs,
    promptPath,
    env: customEnv,
  };
}

export async function runLetta(promptPath: string, options: LettaOptions) {
  const config = prepareRunConfig(promptPath, options);

  // Create a named pipe
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore if file doesn't exist
  }

  // Create the named pipe
  await execAsync(`mkfifo "${PIPE_PATH}"`);

  // Log prompt file size
  let promptSize = "unknown";
  try {
    const stats = await stat(config.promptPath);
    promptSize = stats.size.toString();
  } catch (e) {
    // Ignore error
  }

  console.log(`Prompt file size: ${promptSize} bytes`);

  // Log custom arguments if any
  if (options.lettaArgs && options.lettaArgs.trim() !== "") {
    console.log(`Custom Letta arguments: ${options.lettaArgs}`);
  }

  if (options.agentId) {
    console.log(`Resuming agent: ${options.agentId}`);
  }

  // Output to console
  console.log(`Running Letta with prompt from file: ${config.promptPath}`);

  // Use custom executable path if provided, otherwise default to "letta"
  const lettaExecutable = options.pathToLettaExecutable || "letta";
  console.log(`Full command: ${lettaExecutable} ${config.lettaArgs.join(" ")}`);

  // Determine if full output should be shown before configuring child stdio.
  const isDebugMode = process.env.ACTIONS_STEP_DEBUG === "true";
  let showFullOutput = options.showFullOutput === "true" || isDebugMode;

  if (isDebugMode && options.showFullOutput !== "false") {
    console.log("Debug mode detected - showing full output");
    showFullOutput = true;
  } else if (!showFullOutput) {
    console.log("Running Letta Code (full output hidden for security)...");
    console.log(
      "Rerun in debug mode or enable `show_full_output: true` in your workflow file for full output.",
    );
  }

  // Start sending prompt to pipe in background
  const catProcess = spawn("cat", [config.promptPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pipeStream = createWriteStream(PIPE_PATH);
  catProcess.stdout.pipe(pipeStream);

  catProcess.on("error", (error) => {
    if (showFullOutput) console.error("Error reading prompt file:", error);
    pipeStream.destroy();
  });

  const lettaProcess = spawn(lettaExecutable, config.lettaArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...config.env,
    },
  });

  let spawnFailed = false;
  const processCompletion = new Promise<number>((resolve) => {
    lettaProcess.once("close", (code) => resolve(code ?? 1));
    lettaProcess.once("error", (error) => {
      spawnFailed = true;
      pipeStream.destroy();
      if (showFullOutput) {
        console.error("Error spawning Letta process:", error);
      }
      resolve(1);
    });
  });

  // Always drain stderr. Raw stderr is forwarded only after the caller has
  // explicitly opted into full output, since it may contain provider bodies.
  lettaProcess.stderr.on("data", (data) => {
    if (showFullOutput) process.stderr.write(data);
  });
  lettaProcess.stdin.on("error", (error) => {
    if (showFullOutput) console.error("Error writing Letta stdin:", error);
  });

  // Capture output for parsing execution metrics
  let output = "";
  let agentId: string | null = null;
  let conversationId: string | null = null;
  let modelHandle: string | null = null;

  lettaProcess.stdout.on("data", (data) => {
    const text = data.toString();

    // Try to parse as JSON and handle based on verbose setting
    const lines = text.split("\n");
    lines.forEach((line: string, index: number) => {
      if (line.trim() === "") return;

      try {
        const parsed = JSON.parse(line);

        // Capture agent_id, conversation_id, and model from init or result events
        if (parsed.agent_id) {
          agentId = parsed.agent_id;
        }
        if (parsed.conversation_id) {
          conversationId = parsed.conversation_id;
        }
        if (parsed.model) {
          modelHandle = parsed.model;
        }

        // On init event, immediately update the comment with agent info
        // and write agent info to a file the agent can read
        // Init event has type="system" and subtype="init"
        if (
          parsed.type === "system" &&
          parsed.subtype === "init" &&
          parsed.agent_id
        ) {
          updateCommentWithAgentInfo(parsed.agent_id, parsed.conversation_id);

          // Label the conversation with GitHub context (PR/Issue info)
          // Only label NEW conversations - don't rename when resuming (e.g., PR continuing an issue's conversation)
          const isResumingExisting = !!process.env.INPUT_CONVERSATION_ID;
          if (parsed.conversation_id && !isResumingExisting) {
            const repo = process.env.GITHUB_REPOSITORY || "";
            const prNumber = process.env.GITHUB_PR_NUMBER;
            const issueNumber = process.env.GITHUB_ISSUE_NUMBER;

            if (prNumber || issueNumber) {
              const entityType = prNumber ? "PR" : "Issue";
              const entityNum = parseInt(prNumber || issueNumber || "0");
              const summary = buildConversationSummary(
                entityType,
                entityNum,
                repo,
              );
              // Fire and forget - don't block on this
              updateConversationSummary({
                conversationId: parsed.conversation_id,
                summary,
              }).catch((err) =>
                console.error("Failed to label conversation:", err),
              );
            }
          }

          // Write agent info to file so the agent can access it
          const agentInfo = {
            agent_id: parsed.agent_id,
            conversation_id: parsed.conversation_id,
            model: parsed.model || "unknown",
            ade_url: `${ADE_BASE_URL}/${parsed.agent_id}`,
          };
          writeFile(AGENT_INFO_FILE, JSON.stringify(agentInfo, null, 2)).catch(
            (err) => console.error("Failed to write agent info file:", err),
          );
        }

        const sanitizedOutput = sanitizeJsonOutput(parsed, showFullOutput);

        if (sanitizedOutput) {
          process.stdout.write(sanitizedOutput);
          if (index < lines.length - 1 || text.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }
      } catch (e) {
        // Not a JSON object
        if (showFullOutput) {
          process.stdout.write(line);
          if (index < lines.length - 1 || text.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }
      }
    });

    output += text;
  });

  // Handle stdout errors
  lettaProcess.stdout.on("error", (error) => {
    if (showFullOutput) console.error("Error reading Letta stdout:", error);
  });

  // Pipe from named pipe to Letta
  const pipeProcess = spawn("cat", [PIPE_PATH]);
  pipeProcess.stdout.pipe(lettaProcess.stdin);

  // Handle pipe process errors
  pipeProcess.on("error", (error) => {
    if (showFullOutput) console.error("Error reading from named pipe:", error);
    lettaProcess.kill("SIGTERM");
  });

  // Wait for Letta to finish before parsing terminal records. NDJSON records
  // may span arbitrary stdout chunks, so chunk-local parsing is insufficient.
  const exitCode = await processCompletion;
  const outputRecords = parseNdjsonOutput(output);
  const terminalResult = findLastResult(output);
  const typedFailure = validateFailure(terminalResult?.failure);

  for (const record of outputRecords) {
    if (typeof record.agent_id === "string") agentId = record.agent_id;
    if (typeof record.conversation_id === "string") {
      conversationId = record.conversation_id;
    }
    if (typeof record.model === "string") modelHandle = record.model;
  }

  // Clean up processes
  try {
    catProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }
  try {
    pipeProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }

  // Clean up pipe file
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore errors during cleanup
  }

  const hasFailureField =
    terminalResult !== null &&
    Object.prototype.hasOwnProperty.call(terminalResult, "failure");
  const runFailed =
    exitCode !== 0 ||
    terminalResult?.subtype === "error" ||
    terminalResult?.is_error === true ||
    hasFailureField;

  // Set conclusion based on the process and terminal result.
  if (!runFailed) {
    // Try to process the output and save execution metrics
    try {
      await writeFile("output.txt", output);

      // Process output.txt into JSON and save to execution file
      const { stdout: jsonOutput } = await execAsync("jq -s '.' output.txt", {
        maxBuffer: 10 * 1024 * 1024,
      });
      await writeFile(EXECUTION_FILE, jsonOutput);

      console.log(`Log saved to ${EXECUTION_FILE}`);
    } catch (e) {
      core.warning(`Failed to process output for execution metrics: ${e}`);
    }

    core.setOutput("conclusion", "success");
    core.setOutput("execution_file", EXECUTION_FILE);

    // Output agent_id, conversation_id, and model if captured
    if (agentId) {
      console.log(`Agent ID: ${agentId}`);
      core.setOutput("agent_id", agentId);
    }

    // If CLI didn't output conversation_id, fetch it from the API
    if (!conversationId && agentId) {
      console.log("Conversation ID not in CLI output, fetching from API...");
      try {
        conversationId = await getLatestConversation(agentId);
      } catch (e) {
        console.warn("Failed to fetch conversation ID from API:", e);
      }
    }

    if (conversationId) {
      console.log(`Conversation ID: ${conversationId}`);
      core.setOutput("conversation_id", conversationId);
    }
    if (modelHandle) {
      console.log(`Model: ${modelHandle}`);
      core.setOutput("model", modelHandle);
    }
  } else {
    core.setOutput("conclusion", "failure");

    // Still try to save execution file if we have output
    if (output) {
      try {
        await writeFile("output.txt", output);
        const { stdout: jsonOutput } = await execAsync("jq -s '.' output.txt", {
          maxBuffer: 10 * 1024 * 1024,
        });
        await writeFile(EXECUTION_FILE, jsonOutput);
        core.setOutput("execution_file", EXECUTION_FILE);
      } catch (e) {
        // Ignore errors when processing output during failure
      }
    }

    // Output agent_id, conversation_id, and model even on failure (for debugging)
    if (agentId) {
      core.setOutput("agent_id", agentId);

      // Try to fetch conversation_id if not available
      if (!conversationId) {
        try {
          conversationId = await getLatestConversation(agentId);
        } catch (e) {
          // Ignore errors on failure path
        }
      }
    }
    if (conversationId) {
      core.setOutput("conversation_id", conversationId);
    }
    if (modelHandle) {
      core.setOutput("model", modelHandle);
    }

    if (typedFailure) {
      core.setOutput("failure_stage", typedFailure.stage);
      core.setOutput("failure_code", typedFailure.code);
      core.setOutput("failure_message", typedFailure.message);
      core.setOutput(
        "failure_http_status",
        typedFailure.http_status === null ? "" : typedFailure.http_status,
      );
      core.setOutput("failure_retryable", typedFailure.retryable);
      throw new Error(formatFailureSummary(typedFailure));
    }

    if (spawnFailed) {
      throw new Error("Letta Code failed to start.");
    }
    throw new Error(`Letta Code failed (exit code ${exitCode}).`);
  }
}
