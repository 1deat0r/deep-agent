# 05 — Model 1 dry-run: 3 unpaid sample builds from real public postings

Type: task
Status: resolved

## Question

Execute the Model 1 dry-run from the research (`research/business-models.md`
§Model 1): take 3 real public fixed-scope job postings, build each deliverable
to the posting's stated acceptance criteria, and score the build — no bids, no
submissions, no platform interaction. Success per the research: ≥3 of 3 judged
acceptable (owner-scored), correctness proven by tests.

## Answer / run log

(Decisions and scores append here; the ledger is `dry-run/DECISIONS.md`.)

### Build 1 — soroban-defi-analytics#4: CSV export for the volume chart
Specimen: https://github.com/Bigg770/soroban-defi-analytics/issues/4 ·
deliverable in `dry-run/build-01/repo`.

- Wired the "Export CSV" button into `VolumeChart.tsx` header (flex-wrap so it
  stays usable on mobile), keyboard-focusable native button, `aria-label`,
  brief "Exporting…" loading state; uses the scaffolded client-side
  `downloadCsv`/`buildCsvFilename` (columns + filename match the spec).
- Fixed a pre-existing repo defect found during verification: the `.eslintrc`
  referenced `@typescript-eslint` rules without declaring the plugin, and the
  plugin was missing from devDeps — `npm run build` was broken before this
  change. Added the plugin + `plugins` declaration; build now passes.
- Verification: `tsc --noEmit` ✓ · eslint ✓ · `next build` ✓. Cross-browser
  click-through not performed headlessly (Blob+anchor download is the
  standard cross-browser pattern).
- **Score: acceptable** (6/6 criteria met; one bonus repo fix).

### Build 2 — pynventory#76: tests for prompt_non_negative_number
Specimen: https://github.com/blomma-dev/pynventory/issues/76 ·
deliverable in `dry-run/build-02/repo/tests/test_helpers.py`.

- Four tests covering the acceptance criteria exactly: valid input returns the
  converted value; invalid-then-valid retries (input called twice); the error
  message is printed (capsys); a custom converter (`int`) is honored. All via
  `monkeypatch`ed `builtins.input` — no implementation changes.
- Verification: full suite green in a fresh venv from `requirements.txt`
  (19 passed: 15 pre-existing + 4 new).
- **Score: acceptable** (6/6 criteria met).

### Build 3 — pynventory#77: CI checks for pytest and Ruff
Specimen: https://github.com/blomma-dev/pynventory/issues/77 ·
deliverable in `dry-run/build-02/repo/.github/workflows/ci.yml`.

- Workflow runs on pull requests and pushes to main/master: checkout →
  setup-python 3.12 → `pip install -r requirements.txt` → `pytest` → `ruff
  check .`. Failures fail the job (default step semantics).
- Decision (ledger): included `ruff check .` only — `ruff format --check .`
  would fail on 4 pre-existing files and reformatting app code is out of the
  issue's scope.
- Verification: YAML parses; both CI steps pass locally in the venv
  (pytest 19 passed, ruff clean). Not run on GitHub Actions itself (no
  runner here) — honest caveat.
- **Score: acceptable** (6/6 criteria met as far as locally verifiable).

### Dry-run result

3/3 sample builds judged acceptable; one uncovered and fixed a pre-existing
broken build (soroban-defi-analytics lint). Promotion criteria from the
research (≥4/5 builds acceptable, then capped real bids) are on track — real
bidding is the owner's call and stays approval-gated.
