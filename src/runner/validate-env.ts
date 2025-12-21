/**
 * Validates the environment variables required for running Letta Code
 */
export function validateEnvironmentVariables() {
  const lettaApiKey = process.env.LETTA_API_KEY;
  const lettaBaseUrl = process.env.LETTA_BASE_URL;

  const errors: string[] = [];

  // LETTA_API_KEY is required for Letta Cloud
  // (unless using a self-hosted server that doesn't require auth)
  if (!lettaApiKey && !lettaBaseUrl) {
    errors.push("LETTA_API_KEY is required. Get one at https://app.letta.com/");
  }

  // If using custom base URL without API key, warn but don't fail
  // (self-hosted servers may not require auth)
  if (lettaBaseUrl && !lettaApiKey) {
    console.log(
      `Using custom LETTA_BASE_URL: ${lettaBaseUrl} (no API key provided)`,
    );
  }

  if (errors.length > 0) {
    const errorMessage = `Environment variable validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    throw new Error(errorMessage);
  }

  // Log configuration
  if (lettaBaseUrl) {
    console.log(`Letta Base URL: ${lettaBaseUrl}`);
  } else {
    console.log("Using Letta Cloud (https://api.letta.com)");
  }
}
