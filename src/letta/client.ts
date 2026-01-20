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
      console.log(`Found latest conversation for agent: ${firstConversation.id}`);
      return firstConversation.id;
    }

    return null;
  } catch (error) {
    console.error("Error fetching latest conversation:", error);
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
 * @param title - Optional title of the PR/issue
 * @returns A formatted summary string
 */
export function buildConversationSummary(
  entityType: "PR" | "Issue",
  entityNumber: number,
  repository: string,
  title?: string,
): string {
  const prefix = `${repository} ${entityType} #${entityNumber}`;
  if (title) {
    // Truncate title if too long (keep summary under 200 chars)
    const maxTitleLength = 150;
    const truncatedTitle =
      title.length > maxTitleLength
        ? title.slice(0, maxTitleLength - 3) + "..."
        : title;
    return `${prefix}: ${truncatedTitle}`;
  }
  return prefix;
}
