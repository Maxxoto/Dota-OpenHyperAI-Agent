/**
 * LLM advisor configuration loader (RFC-001 §4.1, plan task T1).
 *
 * Precedence (mirrors FunLib/custom_loader.lua):
 *   1. game/Customize/llm.lua  — permanent, user-owned, gitignored tier
 *   2. Built-in defaults       — disabled (G5: the layer ships dark)
 *
 * The user table is validated field-by-field (C6 discipline extends to config:
 * never trust external input). Unknown fields are ignored, invalid values fall
 * back to defaults, numeric values are clamped; nothing throws.
 *
 * Note: `any` parameters in the coercion helpers are runtime-guarded by `type()`
 * checks — this is the repo's tstl idiom for handling untyped Lua tables.
 */

interface LlmPhaseToggles {
	draft: boolean;
	builds: boolean;
	desire: boolean;
	chat: boolean;
}

export interface LlmConfig {
	Enable: boolean;
	Endpoint: string;
	Model: string;
	APIKey: string;
	TimeoutMs: number;
	MaxConcurrent: number;
	Phases: LlmPhaseToggles;
}

function DefaultConfig(): LlmConfig {
	return {
		Enable: true,
		Endpoint: "https://api.groq.com/openai/v1/chat/completions",
		Model: "qwen/qwen3.8-27b",
		APIKey: "",
		TimeoutMs: 8000,
		MaxConcurrent: 1,
		Phases: { draft: true, builds: true, desire: false, chat: true },
	};
}

function AsBool(value: any, fallback: boolean): boolean {
	if (type(value) === "boolean") {
		return value;
	}
	return fallback;
}

function AsString(value: any, fallback: string): string {
	if (type(value) === "string") {
		return value;
	}
	return fallback;
}

function AsNonEmptyString(value: any, fallback: string): string {
	if (type(value) === "string" && value !== "") {
		return value;
	}
	return fallback;
}

function AsClampedNumber(value: any, fallback: number, min: number, max: number): number {
	if (type(value) === "number") {
		return math.min(max, math.max(min, value));
	}
	return fallback;
}

function MergeUserConfig(config: LlmConfig, mod: any): void {
	config.Enable = AsBool(mod.Enable, config.Enable);
	config.Endpoint = AsNonEmptyString(mod.Endpoint, config.Endpoint);
	config.Model = AsNonEmptyString(mod.Model, config.Model);
	config.APIKey = AsString(mod.APIKey, config.APIKey);
	config.TimeoutMs = AsClampedNumber(mod.TimeoutMs, config.TimeoutMs, 1000, 60000);
	config.MaxConcurrent = AsClampedNumber(mod.MaxConcurrent, config.MaxConcurrent, 1, 4);
	if (type(mod.Phases) === "table") {
		config.Phases.draft = AsBool(mod.Phases.draft, config.Phases.draft);
		config.Phases.builds = AsBool(mod.Phases.builds, config.Phases.builds);
		config.Phases.desire = AsBool(mod.Phases.desire, config.Phases.desire);
		config.Phases.chat = AsBool(mod.Phases.chat, config.Phases.chat);
	}
}

let cached: LlmConfig | undefined;

/** Loads (once) and returns the effective LLM config. Never throws. */
export function GetLlmConfig(): LlmConfig {
	if (cached !== undefined) {
		return cached;
	}
	const config = DefaultConfig();
	// Mirror custom_loader.lua: game/Customize (permanent, gitignored) tier wins.
	// pcall-wrapped require avoids tstl static resolution (repo idiom, see aba_defend.ts).
	const [ok, mod] = pcall(require, "game/Customize/llm");
	if (ok && type(mod) === "table") {
		MergeUserConfig(config, mod);
	}
	cached = config;
	return cached;
}
