import type { PlatformName, ProxyFlags } from '../../shared/types';

export type { ProxyFlags };

/**
 * How a proxy starts:
 *  - 'server':  starts a local HTTP server (e.g. headroom proxy, pxpipe-proxy)
 *  - 'wrapper': no server — initializes hooks/rewriters (e.g. RTK)
 */
export type ProxyMode = 'server' | 'wrapper';

/** Environment variables injected into the agent process. */
export type ProxyEnvStyle = 'anthropic' | 'openai' | 'both' | 'none';

export interface ProxyDefinition {
  /** Unique id, used as the key in config. */
  id: string;
  name: string;
  /** Short description shown in the UI. */
  description: string;
  /** How the proxy operates. */
  mode: ProxyMode;
  /** Binary name(s) searched on PATH. */
  executables: string[];
  /** Well-known install locations per platform. */
  wellKnownPaths: Partial<Record<PlatformName, string[]>>;
  /** Command to verify the proxy is installed, e.g. "headroom --version". */
  detectCommand: string;
  /** Default port for the proxy server (only for 'server' mode). */
  defaultPort: number;
  /** Default flags for the proxy. */
  defaultFlags: ProxyFlags;
  /** Build the start command arguments for the proxy binary. */
  buildStartArgs: (port: number, flags: ProxyFlags) => string[];
  /** Which env vars to inject into the agent. */
  envStyle: ProxyEnvStyle;
  /** Install instructions shown in the UI. */
  installInstructions: string;
  /** Accent colour for the UI. */
  accent: string;
  /** Homepage / docs URL. */
  homepage: string;
}

/**
 * Build the environment variables the agent receives based on the proxy's
 * env style and the port it is running on.
 */
export function buildProxyEnv(def: ProxyDefinition, port: number): Record<string, string> {
  const env: Record<string, string> = {};
  const base = `http://127.0.0.1:${port}`;
  if (def.envStyle === 'anthropic' || def.envStyle === 'both') {
    env.ANTHROPIC_BASE_URL = base;
  }
  if (def.envStyle === 'openai' || def.envStyle === 'both') {
    env.OPENAI_BASE_URL = `${base}/v1`;
  }
  return env;
}
