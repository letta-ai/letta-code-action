import { describe, test, expect } from "bun:test";
import {
  findLastResult,
  formatFailureSummary,
  prepareRunConfig,
  sanitizeJsonOutput,
  validateFailure,
} from "../src/runner/run-letta";

describe("prepareRunConfig", () => {
  const mockPromptPath = "/tmp/prompt.txt";

  describe("basic conversation/agent handling", () => {
    test("uses --conversation when conversationId provided", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
      });
      expect(config.lettaArgs).toContain("--conversation");
      expect(config.lettaArgs).toContain("conv-123");
      expect(config.lettaArgs).not.toContain("--agent");
    });

    test("uses --agent when agentId provided without conversation", () => {
      const config = prepareRunConfig(mockPromptPath, {
        agentId: "agent-123",
      });
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-123");
      expect(config.lettaArgs).not.toContain("--conversation");
      expect(config.lettaArgs).not.toContain("--new");
    });

    test("uses --agent with --new when createNewConversation is true", () => {
      const config = prepareRunConfig(mockPromptPath, {
        agentId: "agent-123",
        createNewConversation: true,
      });
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-123");
      expect(config.lettaArgs).toContain("--new");
    });
  });

  describe("user --agent in lettaArgs (bracket syntax) conflict handling", () => {
    test("user --agent in lettaArgs overrides existing conversation", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "--agent agent-456",
      });
      // Should use user's agent with --new, NOT the existing conversation
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-456");
      expect(config.lettaArgs).toContain("--new");
      // Should NOT contain the existing conversation
      expect(config.lettaArgs).not.toContain("--conversation");
      expect(config.lettaArgs).not.toContain("conv-123");
    });

    test("user --agent overrides configured agentId", () => {
      const config = prepareRunConfig(mockPromptPath, {
        agentId: "agent-configured",
        conversationId: "conv-123",
        lettaArgs: "--agent agent-user-requested",
      });
      expect(config.lettaArgs).toContain("agent-user-requested");
      expect(config.lettaArgs).not.toContain("agent-configured");
      expect(config.lettaArgs).not.toContain("conv-123");
    });

    test("user --agent with --new still works", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "--agent agent-456 --new",
      });
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-456");
      expect(config.lettaArgs).toContain("--new");
      expect(config.lettaArgs).not.toContain("--conversation");
    });

    test("user -a (short alias) in lettaArgs overrides existing conversation", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "-a agent-456",
      });
      // Should use user's agent with --new, NOT the existing conversation
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-456");
      expect(config.lettaArgs).toContain("--new");
      // Should NOT contain the existing conversation
      expect(config.lettaArgs).not.toContain("--conversation");
      expect(config.lettaArgs).not.toContain("conv-123");
      // Should NOT contain -a (it gets normalized to --agent)
      expect(config.lettaArgs).not.toContain("-a");
    });

    test("user -a overrides configured agentId", () => {
      const config = prepareRunConfig(mockPromptPath, {
        agentId: "agent-configured",
        conversationId: "conv-123",
        lettaArgs: "-a agent-user-requested",
      });
      expect(config.lettaArgs).toContain("agent-user-requested");
      expect(config.lettaArgs).not.toContain("agent-configured");
      expect(config.lettaArgs).not.toContain("conv-123");
    });

    test("user -a with --new still works", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "-a agent-456 --new",
      });
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-456");
      expect(config.lettaArgs).toContain("--new");
      expect(config.lettaArgs).not.toContain("--conversation");
    });
  });

  describe("user --new flag handling", () => {
    test("user --new with existing agent starts fresh on that agent", () => {
      const config = prepareRunConfig(mockPromptPath, {
        agentId: "agent-123",
        conversationId: "conv-456",
        lettaArgs: "--new",
      });
      expect(config.lettaArgs).toContain("--agent");
      expect(config.lettaArgs).toContain("agent-123");
      expect(config.lettaArgs).toContain("--new");
      expect(config.lettaArgs).not.toContain("--conversation");
    });

    test("user --new without agent uses --new flag alone", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-456",
        lettaArgs: "--new",
      });
      // Should use --new but not --conversation
      expect(config.lettaArgs).toContain("--new");
      expect(config.lettaArgs).not.toContain("--conversation");
      // Since no agentId, --agent should not be present
      expect(config.lettaArgs).not.toContain("--agent");
    });
  });

  describe("preserves other custom args", () => {
    test("preserves other custom args when extracting --agent", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "--agent agent-456 --max-turns 5",
      });
      expect(config.lettaArgs).toContain("--max-turns");
      expect(config.lettaArgs).toContain("5");
    });

    test("preserves model from custom args", () => {
      const config = prepareRunConfig(mockPromptPath, {
        conversationId: "conv-123",
        lettaArgs: "-m haiku",
      });
      // Should still resume conversation since no --agent override
      expect(config.lettaArgs).toContain("--conversation");
      expect(config.lettaArgs).toContain("-m");
      expect(config.lettaArgs).toContain("haiku");
    });

    test("model from options is included", () => {
      const config = prepareRunConfig(mockPromptPath, {
        model: "opus",
      });
      expect(config.lettaArgs).toContain("-m");
      expect(config.lettaArgs).toContain("opus");
    });
  });

  describe("environment handling", () => {
    test("routes execution through the configured environment", () => {
      const config = prepareRunConfig(mockPromptPath, {
        environment: "letta-mini",
      });
      expect(config.lettaArgs).toContain("--environment");
      expect(config.lettaArgs).toContain("letta-mini");
    });

    test("does not route execution when environment is empty", () => {
      const config = prepareRunConfig(mockPromptPath, {
        environment: "",
      });
      expect(config.lettaArgs).not.toContain("--environment");
    });
  });

  describe("always includes required flags", () => {
    test("always includes --yolo flag", () => {
      const config = prepareRunConfig(mockPromptPath, {});
      expect(config.lettaArgs).toContain("--yolo");
    });

    test("always includes -p flag", () => {
      const config = prepareRunConfig(mockPromptPath, {});
      expect(config.lettaArgs).toContain("-p");
    });

    test("always includes --output-format stream-json", () => {
      const config = prepareRunConfig(mockPromptPath, {});
      expect(config.lettaArgs).toContain("--output-format");
      expect(config.lettaArgs).toContain("stream-json");
    });
  });

  describe("returns correct config structure", () => {
    test("returns promptPath in config", () => {
      const config = prepareRunConfig(mockPromptPath, {});
      expect(config.promptPath).toBe(mockPromptPath);
    });

    test("returns env object", () => {
      const config = prepareRunConfig(mockPromptPath, {});
      expect(config.env).toBeDefined();
      expect(typeof config.env).toBe("object");
    });
  });
});

describe("stream-json typed failures", () => {
  test("parses and formats a typed 402 failure", () => {
    const output = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "result",
        is_error: true,
        failure: {
          stage: "provider_request",
          code: "payment_required",
          message: "Payment is required",
          http_status: 402,
          retryable: false,
          client_message_ids: ["message-1"],
        },
      }),
    ].join("\n");

    const failure = validateFailure(findLastResult(output)?.failure);
    expect(failure).toEqual({
      stage: "provider_request",
      code: "payment_required",
      message: "Payment is required",
      http_status: 402,
      retryable: false,
    });
    expect(formatFailureSummary(failure!)).toBe(
      "Letta Code failed at provider_request [payment_required] (HTTP 402): Payment is required (retryable: false)",
    );
  });

  test("parses a retryable typed 500 failure", () => {
    const failure = validateFailure({
      stage: "api",
      code: "internal_error",
      message: "Provider temporarily unavailable",
      http_status: 500,
      retryable: true,
      client_message_ids: [],
    });

    expect(failure?.http_status).toBe(500);
    expect(failure?.retryable).toBe(true);
    expect(formatFailureSummary(failure!)).toContain("(retryable: true)");
  });

  test("rejects malformed typed failure data", () => {
    expect(
      validateFailure({
        stage: "provider request",
        code: "payment_required",
        message: "Payment is required",
        http_status: 99,
        retryable: "false",
      }),
    ).toBeNull();
    expect(
      validateFailure({
        stage: "provider",
        code: "server_error",
        message: "Safe message",
        http_status: 500,
        retryable: true,
        client_message_ids: [42],
      }),
    ).toBeNull();
    expect(
      validateFailure({
        stage: "provider",
        code: "server_error",
        message: "Safe message",
        http_status: 500,
        retryable: true,
      }),
    ).toBeNull();
  });

  test("keeps secure output and the failure summary free of result secrets", () => {
    const secret = "TOP_SECRET_PROVIDER_BODY";
    const output = JSON.stringify({
      type: "result",
      result: secret,
      stderr: secret,
      tool_input: secret,
      tool_output: secret,
      failure: {
        stage: "provider",
        code: "server_error",
        message: `Safe\nmessage\u0000${"x".repeat(600)}`,
        http_status: null,
        retryable: true,
        client_message_ids: [],
      },
    });

    const result = findLastResult(output);
    const secureOutput = sanitizeJsonOutput(result, false);
    expect(secureOutput).not.toContain(secret);
    expect(secureOutput).not.toContain("failure");
    expect(
      sanitizeJsonOutput({ type: "tool", tool_output: secret }, false),
    ).toBeNull();

    const failure = validateFailure(result?.failure);
    const summary = formatFailureSummary(failure!);
    expect(failure?.message).toStartWith("Safe message");
    expect(failure?.message.length).toBe(512);
    expect(summary).not.toContain(secret);
    expect(summary).not.toContain("HTTP");
  });

  test("rejects extra failure keys without exposing their content", () => {
    const secret = "TOP_SECRET_EXTRA_DATA";
    const result = findLastResult(
      JSON.stringify({
        type: "result",
        failure: {
          stage: "provider",
          code: "server_error",
          message: "Safe message",
          http_status: 500,
          retryable: true,
          client_message_ids: [],
          provider_body: secret,
        },
      }),
    );

    const failure = validateFailure(result?.failure);
    expect(failure).toBeNull();
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  test("parses the last result from fully accumulated split chunks", () => {
    const finalResult = JSON.stringify({
      type: "result",
      failure: {
        stage: "billing",
        code: "payment_required",
        message: "Payment required",
        http_status: 402,
        retryable: false,
        client_message_ids: [],
      },
    });
    const chunks = [
      '{"type":"res',
      'ult","failure":{"stage":"old"}}\n',
      finalResult.slice(0, 23),
      finalResult.slice(23),
    ];

    const result = findLastResult(chunks.join(""));
    expect(validateFailure(result?.failure)?.code).toBe("payment_required");
  });

  test("does not synthesize a typed failure when none is present", () => {
    const output = [
      JSON.stringify({ type: "assistant", message: "secret text" }),
      JSON.stringify({ type: "result", is_error: true, result: "secret" }),
    ].join("\n");

    expect(validateFailure(findLastResult(output)?.failure)).toBeNull();
  });
});
