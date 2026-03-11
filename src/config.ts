export type SandboxMode = "interpreter" | "sandbox";

export interface BlaxelSandboxConfig {
  mode?: SandboxMode;

  /** Sandbox-only: container image (ignored in interpreter mode). */
  image?: string;
  memory?: number;
  region?: string;
  autoCreate?: boolean;

  workingDir?: string;
  execTimeout?: number;

  blaxel?: {
    workspace?: string;
    apiKey?: string;
  };
}

export const DEFAULTS = {
  mode: "interpreter" as SandboxMode,
  image: "blaxel/base-image:latest",
  memory: 4096,
  autoCreate: true,
  workingDir: "/home",
  execTimeout: 60_000,
} as const;

export function resolveConfig(cfg: BlaxelSandboxConfig) {
  return {
    mode: cfg.mode ?? DEFAULTS.mode,
    image: cfg.image ?? DEFAULTS.image,
    memory: cfg.memory ?? DEFAULTS.memory,
    region: cfg.region,
    autoCreate: cfg.autoCreate ?? DEFAULTS.autoCreate,
    workingDir: cfg.workingDir ?? DEFAULTS.workingDir,
    execTimeout: cfg.execTimeout ?? DEFAULTS.execTimeout,
    blaxel: cfg.blaxel,
  };
}
