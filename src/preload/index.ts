import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type {
  AgentDefinition,
  AgentRuntime,
  AppConfig,
  LogEntry,
  ScanResult,
} from '../shared/types';

import type { ProxyDefinition } from '../core/proxies/types';

/** Typed API surface exposed to the renderer as window.headroom. */
export interface HeadroomApi {
  platform: string;
  listAgents(): Promise<AgentDefinition[]>;
  scanAll(): Promise<ScanResult[]>;
  scanAgent(agentId: string, explicitPath?: string): Promise<ScanResult>;
  detectHeadroom(): Promise<ScanResult>;
  listProxies(): Promise<ProxyDefinition[]>;
  detectProxy(proxyId?: string, explicitPath?: string): Promise<ScanResult>;
  installProxy(proxyId: string): Promise<{ ok: boolean; message: string }>;
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<{ ok: boolean; error?: string }>;
  start(agentId: string): Promise<AgentRuntime>;
  stop(agentId: string): Promise<AgentRuntime>;
  runtimes(): Promise<AgentRuntime[]>;
  logs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  pickExecutable(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  openPath(target: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  checkPort(port: number): Promise<boolean>;
  killPort(port: number): Promise<{ killed: number; error?: string }>;
  onLog(listener: (entry: LogEntry) => void): () => void;
  onRuntime(listener: (runtime: AgentRuntime) => void): () => void;
}

const api: HeadroomApi = {
  platform: process.platform,
  listAgents: () => ipcRenderer.invoke(IPC.AgentsList),
  scanAll: () => ipcRenderer.invoke(IPC.ScanAll),
  scanAgent: (agentId, explicitPath) => ipcRenderer.invoke(IPC.ScanAgent, agentId, explicitPath),
  detectHeadroom: () => ipcRenderer.invoke(IPC.HeadroomDetect),
  listProxies: () => ipcRenderer.invoke(IPC.ProxyList),
  detectProxy: (proxyId, explicitPath) => ipcRenderer.invoke(IPC.ProxyDetect, proxyId, explicitPath),
  installProxy: (proxyId) => ipcRenderer.invoke(IPC.InstallProxy, proxyId),
  getConfig: () => ipcRenderer.invoke(IPC.ConfigGet),
  saveConfig: (config) => ipcRenderer.invoke(IPC.ConfigSave, config),
  start: (agentId) => ipcRenderer.invoke(IPC.LaunchStart, agentId),
  stop: (agentId) => ipcRenderer.invoke(IPC.LaunchStop, agentId),
  runtimes: () => ipcRenderer.invoke(IPC.RuntimeAll),
  logs: () => ipcRenderer.invoke(IPC.LogsList),
  clearLogs: () => ipcRenderer.invoke(IPC.LogsClear),
  pickExecutable: () => ipcRenderer.invoke(IPC.PickExecutable),
  pickDirectory: () => ipcRenderer.invoke(IPC.PickDirectory),
  openPath: (target) => ipcRenderer.invoke(IPC.OpenPath, target),
  openUrl: (url) => ipcRenderer.invoke(IPC.OpenUrl, url),
  checkPort: (port) => ipcRenderer.invoke(IPC.PortCheck, port),
  killPort: (port) => ipcRenderer.invoke(IPC.PortKill, port),
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
};

contextBridge.exposeInMainWorld('headroom', api);
