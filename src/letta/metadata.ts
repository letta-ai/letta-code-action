/**
 * Metadata parser/formatter for Letta agent persistence.
 *
 * Stores agent ID and model in HTML comments for follow-up resumption:
 * <!-- letta-metadata
 * agent_id: agent-abc123
 * model: opus
 * created: 2024-01-15T10:30:00Z
 * -->
 */

export interface LettaMetadata {
  agentId: string;
  model?: string;
  created?: string;
}

const METADATA_START = "<!-- letta-metadata";
const METADATA_END = "-->";

/**
 * Format metadata as HTML comment to embed in GitHub comments
 */
export function formatMetadata(metadata: LettaMetadata): string {
  const lines = [`agent_id: ${metadata.agentId}`];

  if (metadata.model) {
    lines.push(`model: ${metadata.model}`);
  }

  if (metadata.created) {
    lines.push(`created: ${metadata.created}`);
  } else {
    lines.push(`created: ${new Date().toISOString()}`);
  }

  return `${METADATA_START}\n${lines.join("\n")}\n${METADATA_END}`;
}

/**
 * Parse metadata from comment body
 * Returns null if no metadata found
 */
export function parseMetadata(commentBody: string): LettaMetadata | null {
  const startIndex = commentBody.indexOf(METADATA_START);
  if (startIndex === -1) {
    return null;
  }

  const endIndex = commentBody.indexOf(METADATA_END, startIndex);
  if (endIndex === -1) {
    return null;
  }

  const metadataContent = commentBody.slice(
    startIndex + METADATA_START.length,
    endIndex,
  );

  const lines = metadataContent.trim().split("\n");
  const metadata: Partial<LettaMetadata> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (key) {
      case "agent_id":
        metadata.agentId = value;
        break;
      case "model":
        metadata.model = value;
        break;
      case "created":
        metadata.created = value;
        break;
    }
  }

  if (!metadata.agentId) {
    return null;
  }

  return metadata as LettaMetadata;
}

/**
 * Check if comment body contains Letta metadata
 */
export function hasMetadata(commentBody: string): boolean {
  return commentBody.includes(METADATA_START);
}

/**
 * Update or append metadata to comment body
 */
export function updateMetadataInBody(
  body: string,
  metadata: LettaMetadata,
): string {
  const formattedMetadata = formatMetadata(metadata);

  if (hasMetadata(body)) {
    // Replace existing metadata
    const startIndex = body.indexOf(METADATA_START);
    const endIndex =
      body.indexOf(METADATA_END, startIndex) + METADATA_END.length;
    return body.slice(0, startIndex) + formattedMetadata + body.slice(endIndex);
  }

  // Append metadata at the end
  return `${body}\n\n${formattedMetadata}`;
}
