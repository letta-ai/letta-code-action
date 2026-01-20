import { GITHUB_SERVER_URL } from "../api/config";
import { formatMetadata, hasMetadata } from "../../letta/metadata";

export type ExecutionDetails = {
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
};

export type CommentUpdateInput = {
  currentBody: string;
  actionFailed: boolean;
  executionDetails: ExecutionDetails | null;
  jobUrl: string;
  branchLink?: string;
  prLink?: string;
  branchName?: string;
  triggerUsername?: string;
  errorDetails?: string;
  agentId?: string;
  conversationId?: string;
  model?: string;
};

export function ensureProperlyEncodedUrl(url: string): string | null {
  try {
    // First, try to parse the URL to see if it's already properly encoded
    new URL(url);
    if (url.includes(" ")) {
      const [baseUrl, queryString] = url.split("?");
      if (queryString) {
        // Parse query parameters and re-encode them properly
        const params = new URLSearchParams();
        const pairs = queryString.split("&");
        for (const pair of pairs) {
          const [key, value = ""] = pair.split("=");
          if (key) {
            // Decode first in case it's partially encoded, then encode properly
            params.set(key, decodeURIComponent(value));
          }
        }
        return `${baseUrl}?${params.toString()}`;
      }
      // If no query string, just encode spaces
      return url.replace(/ /g, "%20");
    }
    return url;
  } catch (e) {
    // If URL parsing fails, try basic fixes
    try {
      // Replace spaces with %20
      let fixedUrl = url.replace(/ /g, "%20");

      // Ensure colons in parameter values are encoded (but not in http:// or after domain)
      const urlParts = fixedUrl.split("?");
      if (urlParts.length > 1 && urlParts[1]) {
        const [baseUrl, queryString] = urlParts;
        // Encode colons in the query string that aren't already encoded
        const fixedQuery = queryString.replace(/([^%]|^):(?!%2F%2F)/g, "$1%3A");
        fixedUrl = `${baseUrl}?${fixedQuery}`;
      }

      // Try to validate the fixed URL
      new URL(fixedUrl);
      return fixedUrl;
    } catch {
      // If we still can't create a valid URL, return null
      return null;
    }
  }
}

export function updateCommentBody(input: CommentUpdateInput): string {
  const originalBody = input.currentBody;
  const {
    executionDetails,
    jobUrl,
    branchLink,
    prLink,
    actionFailed,
    branchName,
    triggerUsername,
    errorDetails,
    agentId,
    conversationId,
    model,
  } = input;

  // Extract content from the original comment body
  // First, remove the "Letta Code is working…" or "Letta Code is working..." message
  const workingPattern = /Letta Code is working[…\.]{1,3}(?:\s*<img[^>]*>)?/i;
  let bodyContent = originalBody.replace(workingPattern, "").trim();

  // Also remove any leftover "I'll analyze this..." placeholder text
  bodyContent = bodyContent
    .replace(/I'll analyze this and get back to you\.?\s*/gi, "")
    .trim();

  // Check if there's a PR link in the content
  let prLinkFromContent = "";

  // Match the entire markdown link structure
  const prLinkPattern = /\[Create .* PR\]\((.*)\)$/m;
  const prLinkMatch = bodyContent.match(prLinkPattern);

  if (prLinkMatch && prLinkMatch[1]) {
    const encodedUrl = ensureProperlyEncodedUrl(prLinkMatch[1]);
    if (encodedUrl) {
      prLinkFromContent = encodedUrl;
      // Remove the PR link from the content
      bodyContent = bodyContent.replace(prLinkMatch[0], "").trim();
    }
  }

  // Calculate duration string if available
  let durationStr = "";
  if (executionDetails?.duration_ms !== undefined) {
    const totalSeconds = Math.round(executionDetails.duration_ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  // Build the header
  let header = "";

  if (actionFailed) {
    header = "**Letta Code encountered an error";
    if (durationStr) {
      header += ` after ${durationStr}`;
    }
    header += "**";
  } else {
    // Get the username from triggerUsername or extract from content
    const usernameMatch = bodyContent.match(/@([a-zA-Z0-9-]+)/);
    const username =
      triggerUsername || (usernameMatch ? usernameMatch[1] : "user");

    header = `**Letta Code finished @${username}'s task`;
    if (durationStr) {
      header += ` in ${durationStr}`;
    }
    header += "**";
  }

  // Add links section
  let links = ` —— [View job](${jobUrl})`;

  // Add branch name with link
  if (branchName || branchLink) {
    let finalBranchName = branchName;
    let branchUrl = "";

    if (branchLink) {
      // Extract the branch URL from the link
      const urlMatch = branchLink.match(/\((https:\/\/.*)\)/);
      if (urlMatch && urlMatch[1]) {
        branchUrl = urlMatch[1];
      }

      // Extract branch name from link if not provided
      if (!finalBranchName) {
        const branchNameMatch = branchLink.match(/tree\/([^"'\)]+)/);
        if (branchNameMatch) {
          finalBranchName = branchNameMatch[1];
        }
      }
    }

    // If we don't have a URL yet but have a branch name, construct it
    if (!branchUrl && finalBranchName) {
      // Extract owner/repo from jobUrl
      const repoMatch = jobUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\//);
      if (repoMatch) {
        branchUrl = `${GITHUB_SERVER_URL}/${repoMatch[1]}/${repoMatch[2]}/tree/${finalBranchName}`;
      }
    }

    if (finalBranchName && branchUrl) {
      links += ` • [\`${finalBranchName}\`](${branchUrl})`;
    } else if (finalBranchName) {
      links += ` • \`${finalBranchName}\``;
    }
  }

  // Add PR link (either from content or provided)
  const prUrl =
    prLinkFromContent || (prLink ? prLink.match(/\(([^)]+)\)/)?.[1] : "");
  if (prUrl) {
    links += ` • [Create PR ➔](${prUrl})`;
  }

  // Build the new body with blank line between header and separator
  let newBody = `${header}${links}`;

  // Add error details if available
  if (actionFailed && errorDetails) {
    newBody += `\n\n\`\`\`\n${errorDetails}\n\`\`\``;
  }

  newBody += `\n\n---\n`;

  // Clean up the body content
  // Remove any existing View job run, branch links from the bottom
  bodyContent = bodyContent.replace(/\n?\[View job run\]\([^\)]+\)/g, "");
  bodyContent = bodyContent.replace(/\n?\[View branch\]\([^\)]+\)/g, "");

  // Remove any existing duration info at the bottom
  bodyContent = bodyContent.replace(/\n*---\n*Duration: [0-9]+m? [0-9]+s/g, "");

  // If body content is empty (agent never updated the comment), add a default message
  if (!bodyContent.trim()) {
    bodyContent = actionFailed
      ? "The agent encountered an issue before updating the comment."
      : "Task completed.";
  }

  // Add the cleaned body content
  newBody += bodyContent;

  // Add agent footer and metadata
  if (agentId) {
    // First strip any existing metadata from the body
    if (hasMetadata(newBody)) {
      const metadataStart = newBody.indexOf("<!-- letta-metadata");
      const metadataEnd = newBody.indexOf("-->", metadataStart) + 3;
      newBody = newBody.slice(0, metadataStart) + newBody.slice(metadataEnd);
    }

    // Strip any existing visible agent footer
    newBody = newBody.replace(
      /\n*---\n+🤖 \*\*Agent:\*\*.*(?:\n.*View in ADE.*)?(?:\n.*Chat with this agent.*)?/g,
      "",
    );

    // Build visible footer
    const adeUrl = `https://app.letta.com/agents/${agentId}`;
    let footer = `\n\n---\n🤖 **Agent:** [\`${agentId}\`](${adeUrl})`;
    if (conversationId) {
      footer += ` • **Conversation:** \`${conversationId}\``;
    }
    if (model) {
      footer += ` • **Model:** ${model}`;
    }
    footer += `\n[View in ADE](${adeUrl}) • [View job run](${jobUrl})`;

    // CLI command: use --conv if conversation_id available, otherwise --agent
    const cliCommand = conversationId
      ? `letta --conv ${conversationId}`
      : `letta --agent ${agentId}`;
    footer += `\n💻 Chat with this agent in your terminal using [Letta Code](https://github.com/letta-ai/letta-code): \`${cliCommand}\``;

    // Append visible footer
    newBody = newBody.trim() + footer;

    // Append hidden metadata for persistence (includes conversation_id for resumption)
    const metadata = formatMetadata({
      agentId,
      conversationId,
      model,
    });
    newBody = newBody + "\n\n" + metadata;
  }

  return newBody.trim();
}
