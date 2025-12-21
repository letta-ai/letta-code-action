import * as core from "@actions/core";

export function collectActionInputsPresence(): void {
  const inputDefaults: Record<string, string> = {
    trigger_phrase: "@letta-code",
    assignee_trigger: "",
    label_trigger: "letta",
    base_branch: "",
    branch_prefix: "letta/",
    allowed_bots: "",
    mode: "tag",
    model: "",
    fallback_model: "",
    allowed_tools: "",
    disallowed_tools: "",
    custom_instructions: "",
    direct_prompt: "",
    override_prompt: "",
    additional_permissions: "",
    letta_api_key: "",
    github_token: "",
    max_turns: "",
    use_sticky_comment: "false",
    use_commit_signing: "false",
  };

  const allInputsJson = process.env.ALL_INPUTS;
  if (!allInputsJson) {
    console.log("ALL_INPUTS environment variable not found");
    core.setOutput("action_inputs_present", JSON.stringify({}));
    return;
  }

  let allInputs: Record<string, string>;
  try {
    allInputs = JSON.parse(allInputsJson);
  } catch (e) {
    console.error("Failed to parse ALL_INPUTS JSON:", e);
    core.setOutput("action_inputs_present", JSON.stringify({}));
    return;
  }

  const presentInputs: Record<string, boolean> = {};

  for (const [name, defaultValue] of Object.entries(inputDefaults)) {
    const actualValue = allInputs[name] || "";

    const isSet = actualValue !== defaultValue;
    presentInputs[name] = isSet;
  }

  core.setOutput("action_inputs_present", JSON.stringify(presentInputs));
}
