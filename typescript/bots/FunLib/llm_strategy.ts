/**
 * Strategy binding (RFC-002 §5): asks the Groq gateway for one
 * `oha-strategy-v1` directive at a match checkpoint and validates it through
 * llm_strategy_core. Fire-and-observe: a failed, discarded or late ask yields
 * undefined and the caller keeps the previous directive (G5).
 */
/// <reference path="../ts_libs/dota/globals.d.ts" />
import { Ask, Enabled } from "./llm_gateway";
import { ParseStrategy, type StrategyDirective } from "./llm_strategy_core";

const jsonlib = require("bots/ts_libs/utils/json");

const STRATEGY_TTL_SEC = 60;

const SYSTEM_PROMPT = [
	"You are the team strategist for a Dota 2 bot team.",
	"Read the match state and return ONE JSON object, nothing else.",
	'Shape: {"schema":"oha-strategy-v1","push":{"top":0,"mid":0,"bot":0},'
	+ '"defend":{"top":0,"mid":0,"bot":0},"farm":{"top":0,"mid":0,"bot":0},'
	+ '"rosh":0,"stance":"group","note":"short reason"}',
	'Every lane weight and rosh is a number in 0..1; stance is one of "group", "split-push", "defend", "aggro".',
	"`note` is one short line, at most 120 characters.",
	"No prose, no markdown, no code fences outside the JSON.",
].join(" ");

function TrimFences(text: string): string {
	let t = text.trim();
	if (t.slice(0, 3) === "```") {
		const nl = t.indexOf("\n");
		t = nl >= 0 ? t.slice(nl + 1) : t.slice(3);
	}
	if (t.length >= 3 && t.slice(t.length - 3) === "```") {
		t = t.slice(0, t.length - 3);
	}
	return t.trim();
}

/** Whether a strategy ask could dispatch right now (master gate + phase toggle). */
export function StrategyEnabled(): boolean {
	return Enabled("desire");
}

/** One non-blocking checkpoint ask; onDone always fires exactly once. */
export function AskStrategy(
	matchJson: string,
	onDone: (d: StrategyDirective | undefined) => void
): void {
	Ask("desire", SYSTEM_PROMPT, matchJson, STRATEGY_TTL_SEC, (ok, text) => {
		if (!ok) {
			onDone(undefined);
			return;
		}
		let raw: any;
		try {
			raw = jsonlib.decode(TrimFences(text));
		} catch {
			onDone(undefined);
			return;
		}
		onDone(ParseStrategy(raw));
	});
}

function OneDecimal(value: number): string {
	const scaled = Math.round(value * 10);
	const whole = Math.floor(scaled / 10);
	return whole + "." + (scaled - whole * 10);
}

function LaneSummary(label: string, weights: { top: number; mid: number; bot: number }): string {
	const parts: string[] = [];
	if (weights.top > 0) {
		parts.push("top " + OneDecimal(weights.top));
	}
	if (weights.mid > 0) {
		parts.push("mid " + OneDecimal(weights.mid));
	}
	if (weights.bot > 0) {
		parts.push("bot " + OneDecimal(weights.bot));
	}
	if (parts.length === 0) {
		return label + " none";
	}
	return label + " " + parts.join(" / ");
}

/** Audit line for the visible strategy channels: stance, non-zero push lanes, ask index. */
export function StrategyAnnouncement(
	d: StrategyDirective,
	minute: number,
	askIndex: number,
	maxAsks: number
): string {
	return (
		"[OHA-LLM] strategy @" + Math.floor(minute) + "m: " + d.stance + ", "
		+ LaneSummary("push", d.push)
		+ " (ask " + askIndex + "/" + maxAsks + ")"
	);
}
