import * as core from "@actions/core";
import { exec } from "child_process";
import { promisify } from "util";
import { unlink, writeFile, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { spawn } from "child_process";
import { parse as parseShellArgs } from "shell-quote";

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
async function updateCommentWithAgentInfo(agentId: string, model: string) {
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

  const adeLink = `${ADE_BASE_URL}/${agentId}`;
  const jobLink = `${serverUrl}/${repo}/actions/runs/${runId}`;

  const body = `Letta Code is working… <img src="https://github.com/user-attachments/assets/05be199b-c834-407f-8371-6f4b91435b71" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />

---
🤖 **Agent:** [\`${agentId}\`](${adeLink}) • **Model:** ${model}
[View in ADE](${adeLink}) • [View job run](${jobLink})
💻 Chat with this agent in your terminal using [Letta Code](https://github.com/letta-ai/letta-code): \`letta --agent ${agentId}\``;

  try {
    await execAsync(
      `gh api /repos/${repo}/issues/comments/${commentId} -X PATCH -f body='${body.replace(/'/g, "'\\''")}'`,
    );
    console.log(`Updated comment with agent info: ${agentId}`);
  } catch (error) {
    console.error("Failed to update comment with agent info:", error);
    // Don't fail the run if comment update fails
  }
}

/**
 * Sanitizes JSON output to remove sensitive information when full output is disabled
 * Returns a safe summary message or null if the message should be completely suppressed
 */
function sanitizeJsonOutput(
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
  pathToLettaExecutable?: string;
  showFullOutput?: string;
};

type PreparedConfig = {
  lettaArgs: string[];
  promptPath: string;
  env: Record<string, string>;
};

export function prepareRunConfig(
  promptPath: string,
  options: LettaOptions,
): PreparedConfig {
  // Build Letta CLI arguments:
  // 1. Agent flag if resuming
  // 2. Model flag if specified
  // 3. Prompt flag
  // 4. User's custom args
  // 5. BASE_ARGS (always last)

  const lettaArgs: string[] = [];

  // Resume specific agent if ID provided
  if (options.agentId) {
    lettaArgs.push("--agent", options.agentId);
  }

  // Model selection
  if (options.model) {
    lettaArgs.push("-m", options.model);
  }

  // YOLO mode - auto-approve all tool calls in headless mode
  // This is required for CI where there's no human to approve
  lettaArgs.push("--yolo");

  // Prompt flag
  lettaArgs.push("-p");

  // Parse and add user's custom arguments
  if (options.lettaArgs?.trim()) {
    const parsed = parseShellArgs(options.lettaArgs);
    const customArgs = parsed.filter(
      (arg): arg is string => typeof arg === "string",
    );
    lettaArgs.push(...customArgs);
  }

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

  // Start sending prompt to pipe in background
  const catProcess = spawn("cat", [config.promptPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pipeStream = createWriteStream(PIPE_PATH);
  catProcess.stdout.pipe(pipeStream);

  catProcess.on("error", (error) => {
    console.error("Error reading prompt file:", error);
    pipeStream.destroy();
  });

  const lettaProcess = spawn(lettaExecutable, config.lettaArgs, {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      ...config.env,
    },
  });

  // Handle Letta process errors
  lettaProcess.on("error", (error) => {
    console.error("Error spawning Letta process:", error);
    pipeStream.destroy();
  });

  // Determine if full output should be shown
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

  // Capture output for parsing execution metrics
  let output = "";
  let agentId: string | null = null;
  let modelHandle: string | null = null;

  lettaProcess.stdout.on("data", (data) => {
    const text = data.toString();

    // Try to parse as JSON and handle based on verbose setting
    const lines = text.split("\n");
    lines.forEach((line: string, index: number) => {
      if (line.trim() === "") return;

      try {
        const parsed = JSON.parse(line);

        // Capture agent_id and model from init or result events
        if (parsed.agent_id) {
          agentId = parsed.agent_id;
        }
        if (parsed.model) {
          modelHandle = parsed.model;
        }

        // On init event, immediately update the comment with agent info
        // and write agent info to a file the agent can read
        if (parsed.type === "init" && parsed.agent_id) {
          updateCommentWithAgentInfo(
            parsed.agent_id,
            parsed.model || "unknown",
          );
          // Write agent info to file so the agent can access it
          const agentInfo = {
            agent_id: parsed.agent_id,
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
    console.error("Error reading Letta stdout:", error);
  });

  // Pipe from named pipe to Letta
  const pipeProcess = spawn("cat", [PIPE_PATH]);
  pipeProcess.stdout.pipe(lettaProcess.stdin);

  // Handle pipe process errors
  pipeProcess.on("error", (error) => {
    console.error("Error reading from named pipe:", error);
    lettaProcess.kill("SIGTERM");
  });

  // Wait for Letta to finish
  const exitCode = await new Promise<number>((resolve) => {
    lettaProcess.on("close", (code) => {
      resolve(code || 0);
    });

    lettaProcess.on("error", (error) => {
      console.error("Letta Code process error:", error);
      resolve(1);
    });
  });

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

  // Set conclusion based on exit code
  if (exitCode === 0) {
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

    // Output agent_id and model if captured
    if (agentId) {
      console.log(`Agent ID: ${agentId}`);
      core.setOutput("agent_id", agentId);
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

    // Output agent_id and model even on failure (for debugging)
    if (agentId) {
      core.setOutput("agent_id", agentId);
    }
    if (modelHandle) {
      core.setOutput("model", modelHandle);
    }

    process.exit(exitCode);
  }
}
