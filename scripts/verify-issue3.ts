/* Standalone verification for Issue #3 core logic (run via esbuild+node). */
import { AGENTS, getAgent, hasAgent } from '../src/core/agents';
import { PROXIES, getProxy } from '../src/core/proxies/registry';
import { isCompatible, compatibleAgentIds, detectionStatus } from '../src/core/compatibility';
import {
  defaultConfig,
  mergeConfig,
  defaultCustomAgent,
  defaultCustomProxy,
  validateCustomAgent,
  validateCustomProxy,
  customAgentToDefinition,
  customProxyToDefinition,
  slugify,
} from '../src/core/config';
import { LaunchTracker } from '../src/core/launch-records';
import type { AgentDefinition, AppConfig } from '../src/shared/types';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.log(` FAIL ${name}`);
    failures++;
  }
}

console.log('AGENTS:', AGENTS.length, 'PROXIES:', PROXIES.length);

// New agents present
check('gemini added', hasAgent('gemini'));
check('windsurf added', hasAgent('windsurf'));
check('devin added', hasAgent('devin'));
check('roo added', hasAgent('roo'));
check('replit added', hasAgent('replit'));
check('pi-coding added', hasAgent('pi-coding'));
check('antigravity added', hasAgent('antigravity'));
check('t3 added', hasAgent('t3'));
check('commandcode added', hasAgent('commandcode'));

// New compressors present
for (const id of ['supercompress', 'selective-ctx', 'squeez', 'omni-route', 'graphify', 'ponytail']) {
  check(`proxy ${id} added`, !!getProxy(id));
}

// Unique ports across agents
const ports = new Set(AGENTS.map((a) => a.defaultPort));
check('agent ports unique', ports.size === AGENTS.length);

// Compatibility
const claude = getAgent('claude');
const wrapper = { id: 'rtk', mode: 'wrapper', envStyle: 'none' as const };
check('rtk compatible with claude (cli)', isCompatible(wrapper as never, claude as AgentDefinition));
const zcode = getAgent('zcode');
check('rtk incompatible with gui (zcode)', !isCompatible(wrapper as never, zcode as AgentDefinition));
const server = { id: 'headroom', mode: 'server', envStyle: 'both' as const };
check('headroom compatible with claude', isCompatible(server as never, claude as AgentDefinition));
check('compat agent ids includes claude', compatibleAgentIds('headroom', server as never, AGENTS).includes('claude'));

// Detection status
check('detection installed', detectionStatus({ agentId: 'x', found: true, paths: ['/a'], source: 'path' }) === 'installed');
check('detection not-found', detectionStatus({ agentId: 'x', found: false, paths: [], source: 'path' }) === 'not-found');
check('detection invalid path', detectionStatus(undefined, '/nope') === 'invalid-path');

// Custom factories
const ca = defaultCustomAgent('  My Agent 2 ');
check('custom agent slug id', ca.id === 'custom-agent-my-agent-2');
check('custom agent valid empty', validateCustomAgent({ ...ca, command: 'myagent' }).length === 0);
const caNoCmd = { ...ca, command: '', binary: '' };
check('custom agent missing command invalid', validateCustomAgent(caNoCmd).length > 0);
const cap = defaultCustomProxy('My Compressor');
check('custom proxy slug id', cap.id === 'custom-proxy-my-compressor');
check('custom proxy missing binary invalid', validateCustomProxy({ ...cap, binary: '' }).length > 0);
const capFilled = { ...cap, binary: '/usr/local/bin/comp' };

// Converters
const adef = customAgentToDefinition({ ...ca, command: 'myagent', args: '--fast" x' });
check('custom agent definition id', adef.id === ca.id);
check('custom agent args split', adef.defaultArgs.length === 2);
const pdef = customProxyToDefinition({ ...capFilled, startCommand: '--port {port} --x' });
check('custom proxy build args port', JSON.stringify(pdef.buildStartArgs(8123)) === JSON.stringify(['--port', '8123', '--x']));
check('custom proxy env base', pdef.executables[0] === 'comp');

// Config merge carries custom entries
const base = defaultConfig();
const merged = mergeConfig({ ...base, customAgents: [{ ...ca, command: 'myagent' }], customProxies: [capFilled] } as AppConfig);
check('merge keeps custom agents', merged.customAgents.some((c) => c.id === ca.id));
check('merge keeps custom proxies', merged.customProxies.some((c) => c.id === cap.id));

// Launch tracker
const t = new LaunchTracker();
const r0 = t.start({ agentId: 'claude', compressorId: 'headroom', profile: 'Default', cwd: '/w', command: 'x', env: { A: '1' }, port: 8798 });
check('launch starts starting', r0.state === 'starting');
t.appendOutput(r0.id, 'line one\nline two\n');
check('launch output appended', t.get(r0.id)!.output.length === 2);
t.setState(r0.id, 'running');
t.stop(r0.id);
check('launch stopped timestamp', typeof t.get(r0.id)!.stoppedAt === 'number');
t.start({ agentId: 'codex', compressorId: 'headroom', profile: 'Default', cwd: '', command: '', env: {}, port: 8989 });
check('launch list newest first', t.list()[0].agentId === 'codex');

console.log(failures === 0 ? '\nALL CORE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
