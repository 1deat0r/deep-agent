// Repeatable real-model task battery for deep-agent.
//
// Run against a live host (real provider configured):
//   node scripts/battery.mjs [--url http://127.0.0.1:3824] [--tasks fizzbuzz,bugfix,delegation,analysis]
//
// Each task runs in a fresh session; fixtures are seeded into the session
// workspace through the filesystem (workspace path comes from /api/config),
// then the task prompt is sent, the turn is polled to idle, and the verifier
// scores the result. Exits 1 if any task fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) =>
    arg.startsWith('--') ? [[arg.slice(2), all[i + 1] ?? 'true']] : [],
  ),
);
const URL = args.url ?? 'http://127.0.0.1:3824';
const ONLY = (args.tasks ?? 'all') === 'all' ? null : String(args.tasks).split(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(`${URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function py(workspace, code) {
  return execFileSync('python3', ['-c', code], { cwd: workspace, encoding: 'utf8' });
}

const TASKS = [
  {
    name: 'fizzbuzz',
    description: 'codegen + test-run',
    fixtures: [],
    prompt:
      'Create fizzbuzz.py in the workspace root with a fizzbuzz(n) function returning a list of strings for 1..n (Fizz/Buzz/FizzBuzz rules), plus a test file. Run the test in the kernel and report the result concisely.',
    async verify(workspace) {
      if (!existsSync(join(workspace, 'fizzbuzz.py'))) return { ok: false, note: 'no fizzbuzz.py' };
      py(
        workspace,
        "import fizzbuzz; r = fizzbuzz.fizzbuzz(15); assert r[0]=='1' and r[2]=='Fizz' and r[4]=='Buzz' and r[14]=='FizzBuzz', 'behavior ok'",
      );
      return { ok: true, note: 'behavior verified' };
    },
  },
  {
    name: 'bugfix',
    description: 'planted-bug fix',
    fixtures: [
      {
        path: 'stats.py',
        content: [
          'def mean(values):',
          '    """Mean of a non-empty sequence; raises ValueError on empty."""',
          '    if not values:',
          '        return 0  # BUG: should raise ValueError',
          '    return sum(values) / len(values)',
          '',
        ].join('\n'),
      },
      {
        path: 'test_stats.py',
        content: [
          'import stats',
          'try:',
          '    stats.mean([])',
          '    raise SystemExit("BUG still present: mean([]) did not raise")',
          'except ValueError:',
          '    pass',
          'assert stats.mean([2, 4, 6]) == 4.0',
          'print("stats fixed")',
          '',
        ].join('\n'),
      },
    ],
    prompt:
      'The test file test_stats.py fails because stats.py has a bug. Run the test, find and fix the bug in stats.py, then run the test again until it passes. Report concisely.',
    async verify(workspace) {
      const out = py(workspace, "exec(open('test_stats.py').read())");
      return { ok: out.includes('stats fixed'), note: out.trim() };
    },
  },
  {
    name: 'delegation',
    description: 'child-agent delegation',
    fixtures: [
      { path: 'a.py', content: 'x = 1\n' },
      { path: 'b.py', content: 'x = 2\n' },
      { path: 'c.py', content: 'x = 3\n' },
      { path: 'notes1.md', content: '# one\n' },
      { path: 'notes2.md', content: '# two\n' },
    ],
    prompt:
      'Spawn TWO child agents with rlm(): one to count .py files in the workspace, one to count .md files. End your turn to let them work; when their replies arrive, report both counts in your answer (e.g. "N python files and M markdown files").',
    async verify(workspace, session) {
      if ((session.children ?? []).length < 2) return { ok: false, note: `only ${session.children?.length ?? 0} children` };
      const summary = session.meta.lastSummary ?? '';
      if (!/\b3\b.*python|\bpython\b.*\b3\b/i.test(summary) || !/2/.test(summary)) {
        return { ok: false, note: `counts unclear in summary: "${summary.slice(0, 120)}"` };
      }
      return { ok: true, note: `children=${session.children.length}, summary ok` };
    },
  },
  {
    name: 'analysis',
    description: 'data analysis',
    fixtures: [{ path: 'data.json', content: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }],
    prompt:
      'Read data.json with the kernel, compute the sum and mean of the numbers, and write summary.json containing {"sum": <int>, "mean": <float>}. Verify the file you wrote by reading it back, then report the two numbers.',
    async verify(workspace) {
      const path = join(workspace, 'summary.json');
      if (!existsSync(path)) return { ok: false, note: 'no summary.json' };
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data.sum !== 55 || Math.abs(data.mean - 5.5) > 1e-9) {
        return { ok: false, note: `wrong values: ${JSON.stringify(data)}` };
      }
      return { ok: true, note: 'sum=55 mean=5.5' };
    },
  },
];

async function runTask(task) {
  const { dataDir } = await api('/api/config');
  const { meta } = await api('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `battery: ${task.name}` }),
  });
  const workspace = join(dataDir, 'sessions', meta.id, 'workspace');
  mkdirSync(workspace, { recursive: true });
  for (const fixture of task.fixtures) {
    writeFileSync(join(workspace, fixture.path), fixture.content);
  }

  const started = Date.now();
  await api(`/api/sessions/${meta.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: task.prompt }),
  });

  let detail = null;
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    detail = await api(`/api/sessions/${meta.id}`);
    if (detail.meta.status !== 'running') break;
    await sleep(4000);
  }
  // Child turns and their parent wake-ups run after the parent idles: wait
  // until the whole tree is idle, then give the wake turn a beat to land.
  while (Date.now() < deadline) {
    detail = await api(`/api/sessions/${meta.id}`);
    const busy =
      detail.meta.status === 'running' ||
      (detail.children ?? []).some((child) => child.status === 'running');
    if (!busy) break;
    await sleep(3000);
  }
  await sleep(3000);
  detail = await api(`/api/sessions/${meta.id}`);
  const ms = Date.now() - started;
  if (detail.meta.status === 'running') {
    return { name: task.name, result: 'FAIL', ms, note: 'timed out after 6 min' };
  }
  try {
    const verdict = await task.verify(workspace, detail);
    return { name: task.name, result: verdict.ok ? 'PASS' : 'FAIL', ms, note: verdict.note };
  } catch (error) {
    return { name: task.name, result: 'FAIL', ms, note: `verify error: ${error.message}` };
  }
}

const tasks = ONLY ? TASKS.filter((t) => ONLY.includes(t.name)) : TASKS;
console.log(`deep-agent battery: ${tasks.length} task(s) against ${URL}`);
const results = [];
for (const task of tasks) {
  process.stdout.write(`  ${task.name} (${task.description}) ... `);
  const result = await runTask(task);
  results.push(result);
  console.log(`${result.result} ${Math.round(result.ms / 1000)}s — ${result.note}`);
}
console.log('---');
const failed = results.filter((r) => r.result !== 'PASS');
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
