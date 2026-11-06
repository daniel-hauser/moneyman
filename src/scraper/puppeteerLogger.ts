import { context, type Context } from "@opentelemetry/api";
import { isOperationDescendant } from "../utils/telemetry.js";
import type { LaunchOptions } from "puppeteer";
import debug from "debug";
import "../utils/logger.js";

type Owner = { context: Context };
type Command = {
  owner: Owner;
  resourceOwner: Owner;
  method: string;
  browserContext?: string;
  target?: string;
  session?: string;
  at: number;
};
type Payload = Record<string, unknown>;
const limit = 10_000;
const commandLifetime = 10 * 60_000;

function object(value: unknown): Payload | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Payload)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function get<T>(map: Map<string, T>, key: unknown): T | undefined {
  return typeof key === "string" ? map.get(key) : undefined;
}

/** One connection owns each map; CDP ids are not unique across browsers. */
export function createPuppeteerLogger(signal: AbortSignal) {
  const browser: Owner = {
    context: context.active(),
  };
  const commands = new Map<number, Command>();
  const contexts = new Map<string, Owner>();
  const targets = new Map<string, { owner: Owner; browserContext?: string }>();
  const sessions = new Map<string, { owner: Owner; target?: string }>();
  if (!signal.aborted) {
    signal.addEventListener(
      "abort",
      () => {
        commands.clear();
        contexts.clear();
        targets.clear();
        sessions.clear();
      },
      { once: true },
    );
  }
  const put = <T>(map: Map<string, T>, key: unknown, value: T) => {
    if (typeof key !== "string") return;
    if (map.size >= limit) map.delete(map.keys().next().value!);
    map.set(key, value);
  };
  const detach = (id: string) => {
    sessions.delete(id);
    for (const [key, command] of commands) {
      if (command.session === id) commands.delete(key);
    }
  };
  const destroyTarget = (id: string) => {
    targets.delete(id);
    for (const [key, session] of sessions) {
      if (session.target === id) detach(key);
    }
  };
  const ownerFor = (message: Payload): Owner | undefined => {
    const params = object(message.params) ?? {};
    return (
      get(sessions, message.sessionId)?.owner ??
      get(contexts, params.browserContextId) ??
      get(targets, params.targetId)?.owner
    );
  };
  const logger: NonNullable<LaunchOptions["logger"]> = (namespace) => {
    // Keep Puppeteer's original namespaces so DEBUG=puppeteer:* works.
    const output = debug(namespace);
    return (...args) => {
      let owner = browser;
      const direction =
        namespace === "puppeteer:protocol:SEND ►"
          ? "send"
          : namespace === "puppeteer:protocol:RECV ◀"
            ? "receive"
            : undefined;
      if (!signal.aborted && direction && typeof args[0] === "string") {
        let message: Payload | undefined;
        try {
          message = object(JSON.parse(args[0]));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (message) {
          const params = object(message.params) ?? {};
          const now = Date.now();
          for (const [id, command] of commands) {
            if (now - command.at > commandLifetime) commands.delete(id);
            else break;
          }
          if (direction === "send") {
            let resourceOwner = ownerFor(message) ?? browser;
            owner = resourceOwner;
            const active = context.active();
            if (
              resourceOwner !== browser &&
              isOperationDescendant(active, resourceOwner.context)
            ) {
              owner = {
                context: active,
              };
            }
            if (message.method === "Target.createBrowserContext") {
              resourceOwner = owner = {
                context: active,
              };
            }
            if (
              typeof message.id === "number" &&
              typeof message.method === "string"
            ) {
              if (commands.size >= limit)
                commands.delete(commands.keys().next().value!);
              commands.set(message.id, {
                owner,
                resourceOwner,
                method: message.method,
                browserContext: string(params.browserContextId),
                target: string(params.targetId),
                session: string(message.sessionId),
                at: now,
              });
            }
          } else {
            const id = typeof message.id === "number" ? message.id : undefined;
            const command = id === undefined ? undefined : commands.get(id);
            owner = command?.owner ?? ownerFor(message) ?? browser;
            if (command && id !== undefined) {
              commands.delete(id);
              const result = object(message.result) ?? {};
              if (command.method === "Target.createBrowserContext")
                put(contexts, result.browserContextId, command.resourceOwner);
              if (command.method === "Target.createTarget")
                put(targets, result.targetId, {
                  owner: command.resourceOwner,
                  browserContext: command.browserContext,
                });
              if (command.method === "Target.attachToTarget")
                put(sessions, result.sessionId, {
                  owner: command.resourceOwner,
                  target: command.target,
                });
              if (
                command.method === "Target.disposeBrowserContext" &&
                !message.error
              ) {
                const id = command.browserContext;
                if (id) contexts.delete(id);
                for (const [key, target] of targets) {
                  if (target.browserContext === id) destroyTarget(key);
                }
              }
            }
            const info = object(params.targetInfo);
            if (info) {
              owner =
                get(contexts, info.browserContextId) ??
                get(targets, info.targetId)?.owner ??
                owner;
              put(targets, info.targetId, {
                owner,
                browserContext: string(info.browserContextId),
              });
            }
            if (message.method === "Target.attachedToTarget")
              put(sessions, params.sessionId, {
                owner,
                target: string(info?.targetId),
              });
            if (
              message.method === "Target.detachedFromTarget" &&
              typeof params.sessionId === "string"
            ) {
              owner = get(sessions, params.sessionId)?.owner ?? owner;
              detach(params.sessionId);
            }
            if (
              message.method === "Target.targetDestroyed" &&
              typeof params.targetId === "string"
            ) {
              owner = get(targets, params.targetId)?.owner ?? owner;
              destroyTarget(params.targetId);
            }
          }
        }
      }
      context.with(owner.context, () => {
        output(args[0], ...args.slice(1));
      });
    };
  };
  return { logger };
}
