/**
 * Offline demo of the RLM loop: run with
 *   node examples/demo.ts   (needs `pnpm build` first)
 *
 * Scripts a model that (1) spawns a child agent, (2) runs shell + file work
 * through the persistent kernel, then ends its turn; the child answers and the
 * parent is woken. No API key required — the mock provider is scripted.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLlmClient, textTurn, toolCallTurn } from '@deep-agent/provider';
import { createHost, loadConfig, DEFAULT_CONFIG } from '@deep-agent/host';

const dataDir = mkdtempSync(join(tmpdir(), 'deep-agent-demo-'));

const rootScripts = [];
const childScripts = [];
const clientFactory = (_config: unknown, ctx: { role: string }) =>
  MockLlmClient.shared(ctx.role === 'child' ? childScripts : rootScripts);

const config = loadConfig({
  ...DEFAULT_CONFIG,
  dataDir,
  provider: { id: 'mock' as const, model: 'mock-model' },
  maxAutoRounds: 3,
});

const host = createHost(config, clientFactory as never);

// Script the model's behaviour:
// turn 1: two tool calls (shell setup, then spawn a child), then end the turn
rootScripts.push(
  toolCallTurn('ipython', {
    code: '%%bash\nmkdir -p scratch && echo "workspace ready" > scratch/status.txt',
  }),
  toolCallTurn('ipython', {
    code: "handle = await rlm('Report the contents of scratch/status.txt', name='reporter')\nprint('spawned', handle['child_id'][:8])",
  }),
  textTurn('The reporter child is running; ending my turn to wait for it.'),
);
// the child's single turn:
childScripts.push(
  toolCallTurn('ipython', { code: "from pathlib import Path\nPath('scratch/status.txt').read_text()" }),
  textTurn('The workspace says: "workspace ready".'),
);
// parent wake-up turn after the child replies:
rootScripts.push(textTurn('Confirmed via the reporter child: workspace ready.'));

const session = await host.manager.createSession({ title: 'demo', goal: 'Verify the RLM loop' });

console.log('— session', session.id, '| kernel workspace:', session.workspaceDir);
console.log('— turn 1 (spawn child, end turn)');
const first = await session.runTurn({ content: 'Set up a workspace and have a child verify it.' });
console.log('  summary:', first.summary);

// wait for the child to finish and the parent to wake
for (let i = 0; i < 200; i++) {
  if (session.meta.lastSummary?.includes('Confirmed')) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

console.log('— transcript:');
for (const entry of session.transcript) {
  if (entry.kind === 'message') {
    const who = entry.name ? `${entry.role}(${entry.name})` : entry.role;
    console.log(`  [${who}] ${(entry.content ?? '').split('\n')[0]?.slice(0, 90)}`);
  } else {
    console.log(`  [cell] ${entry.code.split('\n')[0]?.slice(0, 70)}... → ${entry.resultRepr ?? entry.error ?? ''}`);
  }
}
console.log('— goal:', JSON.stringify(session.meta.goal));
console.log('— children:', JSON.stringify(host.manager.listChildren(session)));

await host.manager.disposeAll();
console.log('done');
