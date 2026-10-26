/**
 * Lua binding for the LLM gateway core (RFC-001 §4.1, plan task T2).
 *
 * Owns: config loading, the Customize.Allow_LLM_Advisor master gate (two-tier
 * loader precedence), the HTTP transport (the CreateHTTPRequest API proven in
 * production by FretBots/Chat.lua), and OpenAI request/response JSON framing.
 * All queueing/budget/cache logic lives in llm_gateway_core (pure, tested).
 */
import { GetLlmConfig } from "./llm_config";
import { CreateGatewayCore } from "./llm_gateway_core";
import type {
	AskCallback,
	GatewayCore,
	GatewayPhase,
	GatewayStats,
	GatewayTransport,
	TelemetryEvent,
} from "./llm_gateway_core";

const jsonlib = require("bots/ts_libs/utils/json");

let masterFlag: boolean | undefined;

// Master switch via the two-tier customize loader (game/Customize overrides
// bots/Customize). pcall-wrapped require avoids tstl static resolution
// (repo idiom, see aba_defend.ts). custom_loader returns the Customize table.
function MasterEnabled(): boolean {
	if (masterFlag !== undefined) {
		return masterFlag;
	}
	masterFlag = false;
	const [ok, customize] = pcall(require, GetScriptDirectory() + "/FunLib/custom_loader");
	if (ok && type(customize) === "table" && customize.Allow_LLM_Advisor === true) {
		masterFlag = true;
	}
	return masterFlag;
}

const transport: GatewayTransport = {
	Post(url, apiKey, model, system, user, respond) {
		const payload = jsonlib.encode({
			model: model,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			temperature: 0.4,
		});
		const req = CreateRemoteHTTPRequest(url);
		req.SetHTTPRequestHeaderValue("Content-Type", "application/json");
		if (apiKey !== "") {
			req.SetHTTPRequestHeaderValue("Authorization", "Bearer " + apiKey);
		}
		req.SetHTTPRequestRawPostBody("application/json", payload);
		req.Send((response: any) => {
			if (response === undefined || type(response) !== "table" || response.StatusCode !== 200) {
				const status = response !== undefined && type(response) === "table"
					? response.StatusCode
					: 0;
				respond(status, "");
				return;
			}
			// dkjson decodes arrays as 1-based Lua tables; any-typed indexing is
			// not shifted by tstl, so use [1] explicitly.
			const [ok, parsed] = pcall(jsonlib.decode, response.Body);
			if (
				!ok ||
				type(parsed) !== "table" ||
				type(parsed.choices) !== "table" ||
				type(parsed.choices[1]) !== "table"
			) {
				respond(200, "");
				return;
			}
			const choice = parsed.choices[1];
			if (type(choice.message) === "table" && type(choice.message.content) === "string") {
				respond(200, choice.message.content);
			} else {
				respond(200, "");
			}
		});
	},
};

let core: GatewayCore | undefined;

function Core(): GatewayCore {
	if (core === undefined) {
		core = CreateGatewayCore(GetLlmConfig(), GameTime, transport);
	}
	return core;
}

/** Ask the LLM. cb receives exactly one result (net/cache/fallback). */
export function Ask(phase: GatewayPhase, system: string, user: string, ttlSec: number, cb: AskCallback): void {
	if (!MasterEnabled()) {
		cb(false, "", "fallback", "master-off");
		return;
	}
	Core().Ask(phase, system, user, ttlSec, cb);
}

/** Whether a phase could dispatch right now (for !llm status). */
export function Enabled(phase: GatewayPhase): boolean {
	return MasterEnabled() && Core().Enabled(phase);
}

export function Stats(): GatewayStats {
	return Core().Stats();
}

export function Telemetry(): TelemetryEvent[] {
	return Core().Telemetry();
}

/** One-line status for the in-game !llm chat command. */
export function StatusLine(): string {
	const config = GetLlmConfig();
	const stats = Core().Stats();
	return `[OHA-LLM] master=${MasterEnabled()} enable=${config.Enable} model=${config.Model} `
		+ `calls(p/c)=${stats.usedPolicy}/${stats.usedChat} `
		+ `inflight=${stats.inflight} pending=${stats.pending} cache=${stats.cacheEntries}`;
}
