# 01: Provider usage cache normalization

Status: resolved

Extend `LlmUsage` with `cacheHitTokens?` / `cacheMissTokens?`. The
openai-compatible parser normalizes two wire shapes:

- OpenAI: `usage.prompt_tokens_details.cached_tokens` (miss = prompt - hit)
- DeepSeek: `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`

Plain usage without cache fields stays as-is. Tests at the
`collectAssistantMessage` seam against a fake SSE server.
