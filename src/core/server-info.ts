export interface ServerInfo {
  name: string;
  version: string;
}

export const DEFAULT_SERVER_INFO: ServerInfo = {
  name: 'Reflection-Based MCP Server',
  version: '1.0.0',
};

export function mergeServerInfo(
  base: ServerInfo,
  ...overrides: Array<Partial<ServerInfo> | undefined>
): ServerInfo {
  let merged: ServerInfo = { ...base };
  for (const override of overrides) {
    if (!override) continue;
    if (override.name !== undefined)
      merged = { ...merged, name: override.name };
    if (override.version !== undefined)
      merged = { ...merged, version: override.version };
  }
  return merged;
}
