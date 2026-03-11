import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { getSandbox } from "../sandbox.js";

export const previewToolDef = {
  name: "sandbox_preview",
  description:
    "Get a public preview URL for a running server in a Blaxel sandbox. " +
    "Call this after starting a dev server with sandbox_exec to get the URL users can visit. " +
    "The sandbox must have been created with the port exposed via sandbox_create. " +
    "Idempotent: returns the same URL if called multiple times for the same port.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox. Use separate names to isolate unrelated projects." }),
    port: Type.Number({ description: "The port to create a preview URL for (must match a port from sandbox_create)." }),
  }),
};

export function createPreviewHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  return async (_id: string, params: { sandboxName: string; port: number }) => {
    try {
      const sandbox = await getSandbox(rawCfg, logger, params.sandboxName);

      logger?.info(`[blaxel-sandbox] Creating preview for port ${params.port} on "${params.sandboxName}"…`);

      const preview = await sandbox.previews.createIfNotExists({
        metadata: { name: `preview-${params.port}` },
        spec: { port: params.port, public: true },
      });

      const url = preview.spec?.url;

      if (!url) {
        return {
          content: [{ type: "text" as const, text: `Preview created for port ${params.port} but no URL was returned. The preview may still be provisioning.` }],
        };
      }

      logger?.info(`[blaxel-sandbox] Preview URL for port ${params.port}: ${url}`);

      return {
        content: [{ type: "text" as const, text: url }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error creating preview: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
