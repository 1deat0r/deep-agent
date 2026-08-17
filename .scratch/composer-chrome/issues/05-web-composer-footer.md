# 05: Web composer footer

Status: resolved

Pure `usageStats(transcript)` helper (unit-tested) returning session + last-turn
totals with cache hit-rate. Composer footer under the textarea: model select
(fed by getModels), reasoning select (auto/low/medium/high), usage readout.
`updateSessionSettings` API client; meta updates apply immediately on success.
