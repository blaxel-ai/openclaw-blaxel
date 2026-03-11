import { SandboxInstance, CodeInterpreter } from "@blaxel/core";
import type { BlaxelSandboxConfig } from "./config.js";
import { resolveConfig } from "./config.js";

const cache = new Map<string, SandboxInstance | CodeInterpreter>();

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

function isBlaxelCloud() {
  return !!process.env.BL_CLOUD;
}

function applyEnv(cfg: BlaxelSandboxConfig) {
  if (isBlaxelCloud()) return;

  if (cfg.blaxel?.workspace) {
    process.env.BL_WORKSPACE = cfg.blaxel.workspace;
  }
  if (cfg.blaxel?.apiKey) {
    process.env.BL_API_KEY = cfg.blaxel.apiKey;
  }
}

export async function getInterpreter(
  rawCfg: BlaxelSandboxConfig,
  logger?: Logger,
  sandboxName?: string,
): Promise<CodeInterpreter> {
  const cfg = resolveConfig(rawCfg);
  const name = sandboxName!;

  const cached = cache.get(name);
  if (cached && cached instanceof CodeInterpreter) {
    return cached;
  }

  applyEnv(rawCfg);

  logger?.info(`[blaxel-sandbox] Creating or connecting to code interpreter "${name}"…`);

  const interpreter = await CodeInterpreter.createIfNotExists(
    { name, memory: cfg.memory, ...(cfg.region ? { region: cfg.region } : {}), labels: { "managed-by": "openclaw" } },
    { safe: true },
  );

  cache.set(name, interpreter);

  logger?.info(`[blaxel-sandbox] Code interpreter "${name}" ready.`);
  return interpreter;
}

export async function getSandbox(
  rawCfg: BlaxelSandboxConfig,
  logger?: Logger,
  sandboxName?: string,
): Promise<SandboxInstance> {
  const cfg = resolveConfig(rawCfg);
  const name = sandboxName!;

  const cached = cache.get(name);
  if (cached) return cached;

  applyEnv(rawCfg);

  if (cfg.mode === "interpreter") {
    return getInterpreter(rawCfg, logger, name);
  }

  let sandbox: SandboxInstance;

  if (cfg.autoCreate) {
    logger?.info(`[blaxel-sandbox] Creating or connecting to sandbox "${name}"…`);
    sandbox = await SandboxInstance.createIfNotExists({
      name,
      image: cfg.image,
      memory: cfg.memory,
      ...(cfg.region ? { region: cfg.region } : {}),
      labels: { "managed-by": "openclaw" },
    });
  } else {
    logger?.info(`[blaxel-sandbox] Connecting to existing sandbox "${name}"…`);
    sandbox = await SandboxInstance.get(name);
  }

  cache.set(name, sandbox);

  logger?.info(`[blaxel-sandbox] Connected to sandbox "${name}".`);
  return sandbox;
}

export function cacheSandbox(name: string, instance: SandboxInstance | CodeInterpreter) {
  cache.set(name, instance);
}

export function clearCachedSandbox(name?: string) {
  if (name) {
    cache.delete(name);
  } else {
    cache.clear();
  }
}
