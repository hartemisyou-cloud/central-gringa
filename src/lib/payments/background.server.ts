/**
 * Acesso ao ExecutionContext do Worker.
 *
 * `ctx.waitUntil` mantém a promise viva depois que a resposta é enviada — ao
 * contrário de um fire-and-forget solto, que o runtime cancela silenciosamente.
 * Em ambientes sem ExecutionContext (dev/Node), `runInBackground` faz `await`,
 * preservando o comportamento atual.
 */

interface ExecutionContextLike {
  waitUntil: (promise: Promise<unknown>) => void;
}

let executionContext: ExecutionContextLike | null = null;

export function setExecutionContext(ctx: unknown): void {
  if (
    ctx &&
    typeof ctx === "object" &&
    typeof (ctx as ExecutionContextLike).waitUntil === "function"
  ) {
    executionContext = ctx as ExecutionContextLike;
  }
}

/** Executa trabalho não-crítico fora do caminho crítico, sem perda silenciosa. */
export async function runInBackground(
  task: () => Promise<unknown>,
  label: string,
): Promise<void> {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[background:${label}]`, error);
    });

  if (executionContext) {
    executionContext.waitUntil(promise);
    return;
  }
  await promise;
}
