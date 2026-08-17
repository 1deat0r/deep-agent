# 02: Provider reasoningEffort option

Status: resolved

`LlmRequestOptions.reasoningEffort?: 'low' | 'medium' | 'high'`. The
openai-compatible client includes `reasoning_effort` in the request body only
when the option is set. Test seam: fake SSE server asserts the request body.
