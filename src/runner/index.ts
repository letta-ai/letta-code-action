#!/usr/bin/env bun

import * as core from "@actions/core";
import { preparePrompt } from "./prepare-prompt";
import { runLetta } from "./run-letta";
import { validateEnvironmentVariables } from "./validate-env";

async function run() {
  try {
    validateEnvironmentVariables();

    const promptConfig = await preparePrompt({
      prompt: process.env.INPUT_PROMPT || "",
      promptFile: process.env.INPUT_PROMPT_FILE || "",
    });

    await runLetta(promptConfig.path, {
      lettaArgs: process.env.INPUT_LETTA_ARGS,
      model: process.env.INPUT_MODEL || process.env.LETTA_MODEL,
      agentId: process.env.INPUT_AGENT_ID || process.env.LETTA_AGENT_ID,
      pathToLettaExecutable: process.env.INPUT_PATH_TO_LETTA_EXECUTABLE,
      showFullOutput: process.env.INPUT_SHOW_FULL_OUTPUT,
    });
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`);
    core.setOutput("conclusion", "failure");
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
