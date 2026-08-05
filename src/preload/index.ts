import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type {
  AgentDefinition,
  AgentRuntime,
  AppConfig,
  CustomAgent,
  CustomProxy,
  LaunchRecord,
  LogEntry,
  ScanResult,
} from '../shared/types';

import type { ProxyDefinition } from '../core/proxies/types';

/** A compatibility row (compressor -> supported agent ids). */
export interface CompatibilityView {
  id: string;
  name: string;
  mode: string;
  envStyle: string;
  agentIds: string[];
}

/** Typed API surface exposed to the renderer as window.headroom. */
export interface HeadroomApi {
  platform: string;
  listAgents(): Promise<AgentDefinition[]>;
  scanAll(): Promise<ScanResult[]>;
  scanAgent(agentId: string, explicitPath?: string): Promise<ScanResult>;
  detectHeadroom(): Promise<ScanResult>;
  listProxies(): Promise<ProxyDefinition[]>;
  detectProxy(proxyId?: string, explicitPath?: string): Promise<ScanResult>;
  installProxy(proxyId: string, optionId?: string): Promise<{ ok: boolean; message: string; paths?: string[]; options?: Array<{ id: string; label: string; command: string; note?: string }> }>;
  installProxyOptions(proxyId: string): Promise<Array<{ id: string; label: string; command: string; note?: string }>>;
  installAgent(agentId: string, optionId?: string): Promise<{ ok: boolean; message: string; paths?: string[]; options?: Array<{ id: string; label: string; command: string; note?: string }> }>;
  installAgentOptions(agentId: string): Promise<Array<{ id: string; label: string; command: string; note?: string }>>;
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<{ ok: boolean; error?: string }>;
  /** Start a launch with optional per-launch compressor selection. */
  start(options: { agentId: string; compressorId?: string }): Promise<AgentRuntime>;
  /** Start an embedded (in-app) launch for the Workflow view. */
  launchEmbedded(options: { agentId: string; compressorId?: string }): Promise<AgentRuntime>;
  /** Stop a launch by its launchId. */
  stop(launchId: string): Promise<AgentRuntime>;
  runtimes(): Promise<AgentRuntime[]>;
  logs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  pickExecutable(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  openPath(target: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  checkPort(port: number): Promise<boolean>;
  killPort(port: number): Promise<{ killed: number; error?: string }>;
  // Full App Redesign / Issue #3 APIs
  getCompatibility(): Promise<CompatibilityView[]>;
  compatibleAgents(compressorId: string): Promise<string[]>;
  saveCustomAgent(agent: CustomAgent): Promise<{ ok: boolean; error?: string; agent?: CustomAgent }>;
  deleteCustomAgent(id: string): Promise<{ ok: boolean }>;
  saveCustomProxy(proxy: CustomProxy): Promise<{ ok: boolean; error?: string; proxy?: CustomProxy }>;
  deleteCustomProxy(id: string): Promise<{ ok: boolean }>;
  launches(): Promise<LaunchRecord[]>;
  /** Write text to a running process's stdin (workflow terminal). */
  writeStdin(launchId: string, text: string, raw?: boolean): Promise<boolean>;
  onLog(listener: (entry: LogEntry) => void): () => void;
  onRuntime(listener: (runtime: AgentRuntime) => void): () => void;
  onOutput(listener: (record: LaunchRecord) => void): () => void;
  /** Raw PTY bytes for the Workflow xterm (ANSI / TUI frames). */
  onTerminalData(listener: (payload: { launchId: string; data: string }) => void): () => void;
}

const api: HeadroomApi = {
  platform: process.platform,
  listAgents: () => ipcRenderer.invoke(IPC.AgentsList),
  scanAll: () => ipcRenderer.invoke(IPC.ScanAll),
  scanAgent: (agentId, explicitPath) => ipcRenderer.invoke(IPC.ScanAgent, agentId, explicitPath),
  detectHeadroom: () => ipcRenderer.invoke(IPC.HeadroomDetect),
  listProxies: () => ipcRenderer.invoke(IPC.ProxyList),
  detectProxy: (proxyId, explicitPath) => ipcRenderer.invoke(IPC.ProxyDetect, proxyId, explicitPath),
  installProxy: (proxyId, optionId) => ipcRenderer.invoke(IPC.InstallProxy, proxyId, optionId),
  installProxyOptions: (proxyId) => ipcRenderer.invoke(IPC.InstallProxyOptions, proxyId),
  installAgent: (agentId, optionId) => ipcRenderer.invoke(IPC.InstallAgent, agentId, optionId),
  installAgentOptions: (agentId) => ipcRenderer.invoke(IPC.InstallAgentOptions, agentId),
  getConfig: () => ipcRenderer.invoke(IPC.ConfigGet),
  saveConfig: (config) => ipcRenderer.invoke(IPC.ConfigSave, config),
  start: (opts) => ipcRenderer.invoke(IPC.LaunchStart, opts),
  launchEmbedded: (opts) => ipcRenderer.invoke(IPC.LaunchEmbedded, opts),
  stop: (launchId) => ipcRenderer.invoke(IPC.LaunchStop, launchId),
  runtimes: () => ipcRenderer.invoke(IPC.RuntimeAll),
  logs: () => ipcRenderer.invoke(IPC.LogsList),
  clearLogs: () => ipcRenderer.invoke(IPC.LogsClear),
  pickExecutable: () => ipcRenderer.invoke(IPC.PickExecutable),
  pickDirectory: () => ipcRenderer.invoke(IPC.PickDirectory),
  openPath: (target) => ipcRenderer.invoke(IPC.OpenPath, target),
  openUrl: (url) => ipcRenderer.invoke(IPC.OpenUrl, url),
  checkPort: (port) => ipcRenderer.invoke(IPC.PortCheck, port),
  killPort: (port) => ipcRenderer.invoke(IPC.PortKill, port),
  // Full App Redesign / Issue #3 APIs
  getCompatibility: () => ipcRenderer.invoke(IPC.CompatibilityGet),
  compatibleAgents: (compressorId) => ipcRenderer.invoke(IPC.CompatibleAgents, compressorId),
  saveCustomAgent: (agent) => ipcRenderer.invoke(IPC.CustomAgentSave, agent),
  deleteCustomAgent: (id) => ipcRenderer.invoke(IPC.CustomAgentDelete, id),
  saveCustomProxy: (proxy) => ipcRenderer.invoke(IPC.CustomProxySave, proxy),
  deleteCustomProxy: (id) => ipcRenderer.invoke(IPC.CustomProxyDelete, id),
  launches: () => ipcRenderer.invoke(IPC.LaunchesList),
  writeStdin: (launchId, text, raw) => ipcRenderer.invoke(IPC.ProcessInput, launchId, text, raw),
  onLog: (listener) => {
    const wrapped = (_e: unknown, entry: LogEntry) => listener(entry);
    ipcRenderer.on(IPC.EventLog, wrapped);
    return () => ipcRenderer.removeListener(IPC.EventLog, wrapped);
  },
  onRuntime: (listener) => {
    const wrapped = (_e: unknown, runtime: AgentRuntime) => listener(runtime);
    ipcRenderer.on(IPC.EventRuntime, wrapped);
    return () => ipcRenderer.removeListener(IPC.EventRuntime, wrapped);
  },
  onOutput: (listener) => {
    const wrapped = (_e: unknown, record: LaunchRecord) => listener(record);
    ipcRenderer.on(IPC.EventOutput, wrapped);
    return () => ipcRenderer.removeListener(IPC.EventOutput, wrapped);
  },
  onTerminalData: (listener) => {
    const wrapped = (_e: unknown, payload: { launchId: string; data: string }) => listener(payload);
    ipcRenderer.on(IPC.EventTerminalData, wrapped);
    return () => ipcRenderer.removeListener(IPC.EventTerminalData, wrapped);
  },
};

contextBridge.exposeInMainWorld('headroom', api);
