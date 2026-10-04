// Run only after app installation, with the target's TypeScript preload.
// The installer itself has no dependencies on the application or SDKs.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const [root, action, name] = process.argv.slice(2);
const load = path => import(pathToFileURL(join(root, path)).href);
await load('server/harness/register-production.ts');
if (action === 'check') {
  const { getHarnessReadiness } = await load('server/harness/readiness.ts');
  const snapshot = await getHarnessReadiness({ fresh: true });
  // Only status fields cross the boundary; never serialize runtime environments.
  console.log(`SWARMCREWS_READINESS=${JSON.stringify(snapshot.harnesses.map(({ name, ready, state, remediation }) => ({ name, ready, state, remediation })))}`);
} else if (action === 'login') {
  const resolvers = {
    claude: ['claude', 'resolveClaudeRuntime', ['auth', 'login']],
    codex: ['codex', 'resolveCodexRuntime', ['login']],
    copilot: ['copilot', 'resolveCopilotRuntime', ['login']],
    opencode: ['opencode', 'resolveOpenCodeRuntime', ['auth', 'login']],
    pi: ['pi', 'resolvePiRuntime', ['/login']],
  };
  const entry = resolvers[name];
  if (!entry) throw new Error('Unknown agent.');
  const module = await load(`server/harness/${entry[0]}/runtime.ts`);
  const runtime = module[entry[1]]();
  if (!runtime) throw new Error('Agent runtime is missing. Install it using its official guide, then rerun setup.');
  if (/\.(cmd|bat)$/i.test(runtime.executable)) throw new Error('Run this agent\'s login in your terminal, then retry the readiness check. Batch wrappers are not shell-executed by setup.');
  const child = spawn(runtime.executable, entry[2], { stdio: 'inherit', shell: false, env: runtime.env || process.env });
  const stop = () => { child.kill('SIGTERM'); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    process.exitCode = code ?? 1;
  });
} else throw new Error('Unknown harness operation.');
