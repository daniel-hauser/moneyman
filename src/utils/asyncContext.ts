import { AsyncLocalStorage } from "async_hooks";

export type RunContext = {
  runId: string;
};

export const runContextStore = new AsyncLocalStorage<RunContext>();
