import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { getInterpreter } from "../sandbox.js";

export const runCodeToolDef = {
  name: "sandbox_run_code",
  description:
    "Execute code in a persistent Jupyter kernel (CodeInterpreter). " +
    "The sandbox is STATEFUL: variables, imports, and all state persist across calls within the same context. " +
    "Use for iterative coding, data analysis, prototyping, and multi-step computations. " +
    "Supports Python (default) and other Jupyter-supported languages. " +
    "You can create multiple isolated contexts in the same sandbox (e.g. one for Python, one for JS) by passing a new contextId. " +
    "Returns stdout, stderr, rich outputs (images, HTML), errors with tracebacks, and the contextId for reuse. " +
    "Use sandbox_exec instead for shell commands (installing packages, running scripts, builds, starting servers).",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox. Use separate names to isolate unrelated projects." }),
    code: Type.String({ description: "The code to execute." }),
    contextId: Type.Optional(
      Type.String({ description: "Reuse a specific execution context by its ID (returned from a previous call). Variables and state persist within a context. If omitted, a default context is created per sandbox." }),
    ),
    language: Type.Optional(
      Type.String({ description: "Language for the Jupyter kernel (e.g. 'python', 'javascript'). Only used when creating a new context. Defaults to 'python'." }),
    ),
    cwd: Type.Optional(
      Type.String({ description: "Working directory for a new context. Only used when creating a new context." }),
    ),
    timeout: Type.Optional(
      Type.Number({ description: "Execution timeout in milliseconds." }),
    ),
  }),
};

export function createRunCodeHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  const contexts = new Map<string, any>();

  return async (_id: string, params: {
    sandboxName: string;
    code: string;
    contextId?: string;
    language?: string;
    cwd?: string;
    timeout?: number;
  }) => {
    try {
      const interpreter = await getInterpreter(rawCfg, logger, params.sandboxName);

      let context: any;
      let contextId: string;

      if (params.contextId) {
        const cached = contexts.get(params.contextId);
        if (cached) {
          context = cached;
          contextId = params.contextId;
        } else {
          context = { id: params.contextId };
          contextId = params.contextId;
        }
      } else {
        const defaultKey = `${params.sandboxName}:${params.language ?? "default"}`;
        context = contexts.get(defaultKey);
        if (!context) {
          context = await interpreter.createCodeContext({
            language: params.language ?? null,
            cwd: params.cwd ?? null,
          });
          contextId = context.id;
          contexts.set(defaultKey, context);
          contexts.set(contextId, context);
        } else {
          contextId = context.id;
        }
      }

      const execution = await interpreter.runCode(params.code, {
        context,
        timeout: params.timeout ?? null,
      });

      const parts: string[] = [];

      if (execution.logs.stdout.length) {
        parts.push(execution.logs.stdout.join(""));
      }
      if (execution.logs.stderr.length) {
        parts.push("--- stderr ---");
        parts.push(execution.logs.stderr.join(""));
      }

      if (execution.error) {
        parts.push("--- error ---");
        parts.push(`${execution.error.name}: ${execution.error.value}`);
        if (execution.error.traceback) {
          const tb = Array.isArray(execution.error.traceback)
            ? execution.error.traceback.join("\n")
            : String(execution.error.traceback);
          parts.push(tb);
        }
      }

      if (execution.results.length) {
        for (const result of execution.results) {
          const entries = Object.entries(result).filter(([k]) => k !== "type");
          if (entries.length) {
            for (const [key, value] of entries) {
              if (key === "text" || key === "plain") {
                parts.push(String(value));
              } else if (key === "html") {
                parts.push(`[HTML output]: ${String(value).slice(0, 500)}`);
              } else if (key === "png" || key === "jpeg" || key === "svg") {
                parts.push(`[${key.toUpperCase()} image output]`);
              } else {
                parts.push(`[${key}]: ${String(value).slice(0, 200)}`);
              }
            }
          }
        }
      }

      const output = parts.join("\n") || "(no output)";

      return {
        content: [{ type: "text" as const, text: `[contextId: ${contextId}]\n${output}` }],
        ...(execution.error ? { isError: true } : {}),
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error running code: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
