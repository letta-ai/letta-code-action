import { describe, test, expect } from "bun:test";
import { prepareRunConfig } from "../src/runner/run-letta";

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
