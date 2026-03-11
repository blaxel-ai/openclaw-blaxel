import { Type } from "@sinclair/typebox";
import { SandboxInstance } from "@blaxel/core";
import { clearCachedSandbox } from "../sandbox.js";

export const deleteToolDef = {
  name: "sandbox_delete",
  description:
    "Delete a Blaxel sandbox and all its data (filesystem, running processes, exposed ports). " +
    "This is irreversible. Use when a project is finished or a sandbox is no longer needed. " +
    "Has no effect if the sandbox does not exist.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox to delete." }),
  }),
};

export function createDeleteHandler(logger?: any) {
  return async (_id: string, params: { sandboxName: string }) => {
    try {
      logger?.info(`[blaxel-sandbox] Deleting sandbox "${params.sandboxName}"…`);

      await SandboxInstance.delete(params.sandboxName);
      clearCachedSandbox(params.sandboxName);

      logger?.info(`[blaxel-sandbox] Sandbox "${params.sandboxName}" deleted.`);

      return {
        content: [{ type: "text" as const, text: `Sandbox "${params.sandboxName}" deleted.` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error deleting sandbox: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
