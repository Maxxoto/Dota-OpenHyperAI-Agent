/**
 * Console logger for the fork's LLM layer.
 *
 * FretBots/Debug.lua replaces global `print` with a no-op unless its own debug
 * flag is on, and FretBots now auto-starts at hero selection — so a plain
 * `print` from the LLM modules would vanish for the whole draft. MsgN writes
 * to the console directly and is not affected by that override.
 */
const realPrint = print;

export function ForkLog(message: string): void {
	pcall(realPrint, message);
	pcall(MsgN, message);
}
