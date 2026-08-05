import { describe, expect, it } from 'vitest';
import { getProxy, hasProxy, proxyIds, PROXIES } from '../src/core/proxies/registry';
import { buildProxyEnv } from '../src/core/proxies/types';

describe('proxy registry', () => {
  it('registers headroom, pxpipe, rtk, llmlingua, tokenshift, caveman, leanctx, supercompress, selective-ctx, squeez, omni-route, graphify, and ponytail', () => {
    const ids = proxyIds();
    expect(ids).toContain('headroom');
    expect(ids).toContain('pxpipe');
    expect(ids).toContain('rtk');
    expect(ids).toContain('llmlingua');
    expect(ids).toContain('tokenshift');
    expect(ids).toContain('caveman');
    expect(ids).toContain('leanctx');
    expect(ids).toContain('supercompress');
    expect(ids).toContain('selective-ctx');
    expect(ids).toContain('squeez');
    expect(ids).toContain('omni-route');
    expect(ids).toContain('graphify');
    expect(ids).toContain('ponytail');
    expect(ids).toHaveLength(13);
  });

  it('hasProxy returns true only for known ids', () => {
    expect(hasProxy('headroom')).toBe(true);
    expect(hasProxy('unknown')).toBe(false);
  });

  it('getProxy returns the definition for known ids', () => {
    const headroom = getProxy('headroom');
    expect(headroom.name).toBe('Headroom');
    expect(headroom.mode).toBe('server');
    expect(headroom.defaultPort).toBe(8989);
  });

  it('getProxy throws for unknown ids', () => {
    expect(() => getProxy('nope')).toThrow(/Unknown proxy id/);
  });
});

describe('headroom definition', () => {
  const def = getProxy('headroom');

  it('builds proxy args with port, mode, and flags', () => {
    const args = def.buildStartArgs(8989, {
      memory: true,
      learn: true,
      mode: 'cache',
      noOptimize: false,
      lossless: false,
    });
    expect(args).toEqual([
      'proxy', '--port', '8989', '--mode', 'cache',
      '--memory', '--learn',
    ]);
  });

  it('includes no-optimize and lossless when set', () => {
    const args = def.buildStartArgs(8798, {
      memory: false,
      learn: false,
      mode: 'token',
      noOptimize: true,
      lossless: true,
    });
    expect(args).toContain('--no-optimize');
    expect(args).toContain('--lossless');
    expect(args).toContain('--mode');
    expect(args).toContain('token');
  });

  it('appends extra args', () => {
    const args = def.buildStartArgs(8989, {
      mode: 'cache',
      extraArgs: '--rpm 120 --no-cache',
    });
    expect(args).toContain('--rpm');
    expect(args).toContain('120');
    expect(args).toContain('--no-cache');
  });

  it('has envStyle both', () => {
    expect(def.envStyle).toBe('both');
  });

  it('has well-known paths for all platforms', () => {
    expect(def.wellKnownPaths.win32).toBeDefined();
    expect(def.wellKnownPaths.darwin).toBeDefined();
    expect(def.wellKnownPaths.linux).toBeDefined();
  });
});

describe('pxpipe definition', () => {
  const def = getProxy('pxpipe');

  it('takes no CLI flags (env-configured binary)', () => {
    const args = def.buildStartArgs(47821, {});
    expect(args).toEqual([]);
  });

  it('exposes the port via buildStartEnv (PORT/HOST)', () => {
    const env = def.buildStartEnv?.(47821, {});
    expect(env).toEqual({ PORT: '47821', HOST: '127.0.0.1' });
  });

  it('has envStyle anthropic only', () => {
    expect(def.envStyle).toBe('anthropic');
  });

  it('uses the standard pxpipe port', () => {
    expect(def.defaultPort).toBe(47821);
  });
});

describe('rtk definition', () => {
  const def = getProxy('rtk');

  it('is wrapper mode', () => {
    expect(def.mode).toBe('wrapper');
  });

  it('has no server port', () => {
    expect(def.defaultPort).toBe(0);
  });

  it('buildStartArgs returns empty array', () => {
    expect(def.buildStartArgs(0, {})).toEqual([]);
  });

  it('has envStyle none', () => {
    expect(def.envStyle).toBe('none');
  });
});

describe('tokenshift definition', () => {
  const def = getProxy('tokenshift');

  it('is server mode', () => {
    expect(def.mode).toBe('server');
  });

  it('buildStartArgs uses port', () => {
    const args = def.buildStartArgs(8992, {});
    expect(args).toEqual(['--port', '8992']);
  });
});

describe('buildProxyEnv', () => {
  it('sets ANTHROPIC_BASE_URL for anthropic style', () => {
    const def = getProxy('pxpipe');
    const env = buildProxyEnv(def, 47821);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:47821');
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });

  it('sets both for both style', () => {
    const def = getProxy('headroom');
    const env = buildProxyEnv(def, 8989);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8989');
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8989/v1');
  });

  it('sets nothing for none style', () => {
    const def = getProxy('rtk');
    const env = buildProxyEnv(def, 0);
    expect(env).toEqual({});
  });
});

describe('all proxy definitions', () => {
  it('every definition has required fields', () => {
    for (const def of PROXIES) {
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.mode).toMatch(/^(server|wrapper)$/);
      expect(def.executables).toBeInstanceOf(Array);
      expect(def.wellKnownPaths).toBeInstanceOf(Object);
      expect(def.detectCommand).toBeTruthy();
      expect(typeof def.defaultPort).toBe('number');
      expect(def.defaultFlags).toBeInstanceOf(Object);
      expect(typeof def.buildStartArgs).toBe('function');
      expect(def.envStyle).toMatch(/^(anthropic|openai|both|none)$/);
      expect(def.installInstructions).toBeTruthy();
      expect(def.accent).toBeTruthy();
      expect(def.homepage).toBeTruthy();
    }
  });

  it('every definition has a unique id', () => {
    const ids = PROXIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
