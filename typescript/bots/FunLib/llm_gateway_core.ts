/**
 * Pure gateway state machine for the LLM advisor (RFC-001 §4.1, plan task T2).
 *
 * Contains no Lua globals: clock and transport are injected, so this module is
 * fully testable under Node (`npm test`). The Lua binding lives in llm_gateway.ts.
 *
 * Guarantees (tested):
 * - Every Ask receives exactly one callback (net / cache / fallback).
 * - One pending job per phase (latest-wins; superseded jobs get a fallback callback).
 * - Budgets increment only on dispatch, never on cache hits.
 * - Timed-out jobs release their slot on the next Pump; late responses are dropped.
 */
import type { LlmConfig } from "./llm_config";

export type GatewayPhase = "draft" | "builds" | "desire" | "chat";
export type BudgetKind = "policy" | "chat";
export type AskCallback = (
    ok: boolean,
    text: string,
    via: "net" | "cache" | "fallback",
    reason?: string
) => void;

export interface TelemetryEvent {
    at: number;
    ev: string;
    phase?: GatewayPhase | undefined;
    detail?: string | undefined;
}

export interface GatewayStats {
    usedPolicy: number;
    usedChat: number;
    inflight: number;
    pending: number;
    cacheEntries: number;
    events: number;
}

export interface GatewayTransport {
    Post(
        this: void,
        url: string,
        apiKey: string,
        model: string,
        system: string,
        user: string,
        respond: (statusCode: number, contentText: string) => void
    ): void;
}

interface CacheEntry {
    text: string;
    at: number;
}

interface Job {
    id: number;
    phase: GatewayPhase;
    kind: BudgetKind;
    system: string;
    user: string;
    cb: AskCallback;
    deadline: number;
}

const CACHE_CAP = 16;
const TELEMETRY_CAP = 200;
const KEY_SEP = "\n#OHA#\n";

export function BudgetKindFor(phase: GatewayPhase): BudgetKind {
    return phase === "chat" ? "chat" : "policy";
}

export function CacheKey(phase: GatewayPhase, system: string, user: string): string {
    return phase + KEY_SEP + system + KEY_SEP + user;
}

export interface GatewayCore {
    Enabled(this: void, phase: GatewayPhase): boolean;
    Ask(this: void, phase: GatewayPhase, system: string, user: string, ttlSec: number, cb: AskCallback): void;
    Pump(this: void): void;
    HandleResponse(this: void, id: number, statusCode: number, contentText: string): void;
    Stats(this: void): GatewayStats;
    Telemetry(this: void): TelemetryEvent[];
}

export function CreateGatewayCore(
    config: LlmConfig,
    clock: () => number,
    transport: GatewayTransport
): GatewayCore {
    let nextId = 1;
    const used = { policy: 0, chat: 0 };
    let inflight: Job[] = [];
    let pending: Job[] = [];
    const cache: { [key: string]: CacheEntry | undefined } = {};
    let cacheOrder: string[] = [];
    const events: TelemetryEvent[] = [];

    function Record(ev: string, phase?: GatewayPhase, detail?: string): void {
        events.push({ at: clock(), ev, phase, detail });
        if (events.length > TELEMETRY_CAP) {
            events.shift();
        }
    }

    function CacheGet(key: string, ttlSec: number): string | undefined {
        const entry = cache[key];
        if (entry === undefined) {
            return undefined;
        }
        if (clock() - entry.at > ttlSec) {
            cache[key] = undefined;
            cacheOrder = cacheOrder.filter((k) => k !== key);
            return undefined;
        }
        return entry.text;
    }

    function CachePut(key: string, text: string): void {
        if (cache[key] === undefined) {
            cacheOrder.push(key);
            if (cacheOrder.length > CACHE_CAP) {
                const oldest = cacheOrder.shift();
                if (oldest !== undefined) {
                    cache[oldest] = undefined;
                }
            }
        }
        cache[key] = { text, at: clock() };
    }

    function ExpireInflight(now: number): void {
        const still: Job[] = [];
        for (const job of inflight) {
            if (job.deadline < now) {
                Record("timeout", job.phase);
                job.cb(false, "", "fallback", "timeout");
            } else {
                still.push(job);
            }
        }
        inflight = still;
    }

    function Dispatch(): void {
        while (inflight.length < config.MaxConcurrent && pending.length > 0) {
            // Policy phases (draft/builds/desire) dispatch before chat.
            let idx = pending.findIndex((j) => j.kind === "policy");
            if (idx < 0) {
                idx = 0;
            }
            const job = pending.splice(idx, 1)[0];
            job.deadline = clock() + config.TimeoutMs / 1000;
            used[job.kind] += 1;
            inflight.push(job);
            Record("dispatch", job.phase);
            const dispatched = job;
            transport.Post(config.Endpoint, config.APIKey, config.Model, job.system, job.user, (
                statusCode,
                contentText
            ) => {
                HandleResponse(dispatched.id, statusCode, contentText);
            });
        }
    }

    function Pump(): void {
        ExpireInflight(clock());
        Dispatch();
    }

    function HandleResponse(id: number, statusCode: number, contentText: string): void {
        const idx = inflight.findIndex((j) => j.id === id);
        if (idx < 0) {
            Record("late-dropped", undefined, "id-" + id);
            return;
        }
        const job = inflight.splice(idx, 1)[0];
        if (statusCode === 200 && contentText !== "") {
            CachePut(CacheKey(job.phase, job.system, job.user), contentText);
            Record("ok", job.phase);
            job.cb(true, contentText, "net");
        } else {
            const reason = "http-" + statusCode;
            Record("fail", job.phase, reason);
            job.cb(false, contentText, "fallback", reason);
        }
        Dispatch();
    }

    function Ask(phase: GatewayPhase, system: string, user: string, ttlSec: number, cb: AskCallback): void {
        const kind = BudgetKindFor(phase);
        if (!config.Enable) {
            Record("ask-rejected", phase, "disabled");
            cb(false, "", "fallback", "disabled");
            return;
        }
        if (!config.Phases[phase]) {
            Record("ask-rejected", phase, "phase-off");
            cb(false, "", "fallback", "phase-off");
            return;
        }
        if (used[kind] >= config.MaxCalls[kind]) {
            Record("ask-rejected", phase, "budget");
            cb(false, "", "fallback", "budget");
            return;
        }
        const hit = CacheGet(CacheKey(phase, system, user), ttlSec);
        if (hit !== undefined) {
            Record("ask-cache-hit", phase);
            cb(true, hit, "cache");
            return;
        }
        const prior = pending.findIndex((j) => j.phase === phase);
        if (prior >= 0) {
            const old = pending.splice(prior, 1)[0];
            Record("ask-superseded", phase);
            old.cb(false, "", "fallback", "superseded");
        }
        pending.push({ id: nextId, phase, kind, system, user, cb, deadline: 0 });
        nextId += 1;
        Record("ask-queued", phase);
        Pump();
    }

    function Enabled(phase: GatewayPhase): boolean {
        const kind = BudgetKindFor(phase);
        return (
            config.Enable === true &&
            config.Phases[phase] === true &&
            used[kind] < config.MaxCalls[kind]
        );
    }

    function Stats(): GatewayStats {
        return {
            usedPolicy: used.policy,
            usedChat: used.chat,
            inflight: inflight.length,
            pending: pending.length,
            cacheEntries: cacheOrder.length,
            events: events.length,
        };
    }

    return {
        Enabled,
        Ask,
        Pump,
        HandleResponse,
        Stats,
        Telemetry: (): TelemetryEvent[] => events.slice(),
    };
}
