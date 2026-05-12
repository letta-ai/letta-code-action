/**
 * Letta API client for conversation management.
 *
 * Used to update conversation metadata (e.g., summary/label) after creation.
 */

const LETTA_API_BASE_URL =
  process.env.LETTA_BASE_URL || "https://api.letta.com";

export interface UpdateConversationOptions {
  conversationId: string;
  summary: string;
}

/**
 * Update a conversation's summary/label via the Letta API.
 *
 * @param options - The update options
 * @returns The updated conversation object
 */
export async function updateConversationSummary(
  options: UpdateConversationOptions,
): Promise<{ id: string; summary: string } | null> {
  const apiKey = process.env.LETTA_API_KEY;

  if (!apiKey) {
    console.warn("LETTA_API_KEY not set, skipping conversation summary update");
    return null;
  }

  const url = `${LETTA_API_BASE_URL}/v1/conversations/${options.conversationId}`;

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        summary: options.summary,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to update conversation summary: ${response.status} ${errorText}`,
      );
      return null;
    }

    const data = (await response.json()) as { id: string; summary: string };
    console.log(
      `Updated conversation ${options.conversationId} with summary: ${options.summary}`,
    );
    return data;
  } catch (error) {
    console.error("Error updating conversation summary:", error);
    return null;
  }
}

/**
 * Get the most recent conversation for an agent.
 * Used as a fallback when the CLI doesn't output conversation_id.
 */
export async function getLatestConversation(
  agentId: string,
): Promise<string | null> {
  const apiKey = process.env.LETTA_API_KEY;

  if (!apiKey) {
    console.warn("LETTA_API_KEY not set, cannot fetch conversation");
    return null;
  }

  const url = `${LETTA_API_BASE_URL}/v1/conversations/?agent_id=${agentId}&limit=1&order=desc`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch conversations: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as Array<{ id: string }>;
    const firstConversation = data?.[0];
    if (firstConversation) {
      console.log(
        `Found latest conversation for agent: ${firstConversation.id}`,
      );
      return firstConversation.id;
    }

    return null;
  } catch (error) {
    console.error("Error fetching latest conversation:", error);
    return null;
  }
}

/**
 * Find an existing conversation for an agent by its summary.
 * Used to resume conversations across review runs on the same PR/issue.
 *
 * @param agentId - The agent ID to search conversations for
 * @param summary - The summary to match (e.g., "owner/repo/pr-123")
 * @param apiKey - Optional API key (reads from LETTA_API_KEY or INPUT_LETTA_API_KEY if not provided)
 * @returns The most recent matching conversation ID, or null
 */
export async function findConversationBySummary(
  agentId: string,
  summary: string,
  apiKey?: string,
): Promise<string | null> {
  const key = apiKey || process.env.LETTA_API_KEY;

  if (!key) {
    console.warn("LETTA_API_KEY not set, cannot search conversations");
    return null;
  }

  const params = new URLSearchParams({
    agent_id: agentId,
    summary,
    limit: "1",
    order: "desc",
  });
  const url = `${LETTA_API_BASE_URL}/v1/conversations/?${params}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to search conversations: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as Array<{
      id: string;
      summary: string;
    }>;
    const match = data?.[0];
    if (match) {
      console.log(`Found existing conversation for ${summary}: ${match.id}`);
      return match.id;
    }

    console.log(`No existing conversation found for ${summary}`);
    return null;
  } catch (error) {
    console.error("Error searching conversations:", error);
    return null;
  }
}

/**
 * Get agent details from the Letta API.
 */
export async function getAgentInfo(
  agentId: string,
): Promise<{ id: string; name: string } | null> {
  const apiKey = process.env.LETTA_API_KEY;

  if (!apiKey) {
    console.warn("LETTA_API_KEY not set, cannot fetch agent info");
    return null;
  }

  const url = `${LETTA_API_BASE_URL}/v1/agents/${agentId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch agent info: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { id: string; name: string };
    return data;
  } catch (error) {
    console.error("Error fetching agent info:", error);
    return null;
  }
}

/**
 * Build a summary string for a conversation based on GitHub context.
 *
 * @param entityType - "PR" or "Issue"
 * @param entityNumber - The PR or issue number
 * @param repository - The repository full name (owner/repo)
 * @returns A formatted summary string like "repo-name/issue-123" or "repo-name/pr-456"
 */
export function buildConversationSummary(
  entityType: "PR" | "Issue",
  entityNumber: number,
  repository: string,
): string {
  // Format: repo-name/issue-123 or repo-name/pr-456
  const entityPrefix = entityType === "PR" ? "pr" : "issue";
  return `${repository}/${entityPrefix}-${entityNumber}`;
}
