# 04: Host session settings route

Status: unclaimed

`POST /api/sessions/:id/settings` `{model?, reasoningEffort?}`. Persists to
meta.json via touch; next turn's client factory receives the new model;
reasoningEffort flows into provider options when set. Test seam: in-process
HostServer + fetch, plus manager-level assertions.
