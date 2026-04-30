const DEFAULT_AI_KEYWORDS = [
  "ai",
  "a.i.",
  "artificial intelligence",
  "machine learning",
  "ml",
  "deep learning",
  "llm",
  "large language model",
  "gpt",
  "chatgpt",
  "claude",
  "gemini",
  "anthropic",
  "openai",
  "copilot",
  "cursor",
  "agent",
  "agentic",
  "rag",
  "transformer",
  "diffusion",
  "stable diffusion",
  "embedding",
  "fine-tune",
  "fine tuning",
  "prompt",
  "mcp",
  "vector",
  "neural",
  "人工知能",
  "機械学習",
  "深層学習",
  "生成ai",
  "生成系ai",
  "言語モデル",
  "プロンプト",
  "エージェント",
] as const;

export type Config = Readonly<{
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  maxItemsPerSource: number;
  aiKeywords: ReadonlyArray<string>;
  dryRun: boolean;
  scrapeTimeoutMs: number;
  anthropicApiKey?: string;
}>;

export function loadConfig(): Config {
  const customKeywords = (process.env.AI_KEYWORDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const keywords = customKeywords.length > 0 ? customKeywords : DEFAULT_AI_KEYWORDS;

  const max = Number.parseInt(process.env.MAX_ITEMS_PER_SOURCE ?? "5", 10);
  const timeout = Number.parseInt(process.env.SCRAPE_TIMEOUT_MS ?? "30000", 10);

  return {
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
    maxItemsPerSource: Number.isFinite(max) && max > 0 ? max : 5,
    aiKeywords: keywords,
    dryRun: process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true",
    scrapeTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30000,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
}

export function isAIRelated(text: string, keywords: ReadonlyArray<string>): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}
