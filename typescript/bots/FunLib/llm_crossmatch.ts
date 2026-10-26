/**
 * Cross-match memory reader (RFC-002 Phase D).
 *
 * The bot VM is sandboxed and cannot write files, so in-game learning is
 * read-only and user-maintained: a Lua module at game/Customize/memory that
 * returns a table like
 *   { notes = "last game: they counter-picked PA with MK", games = 3 }
 * mirrored on the llm_config loader, which pcall-requires game/Customize/llm.
 *
 * Identity default (G5): any missing file, load error, non-table module, or
 * non-string/empty `notes` yields "", and the draft prompt is unchanged
 * (DraftPrompt only appends the MEMORY block for non-empty text). The read is
 * cached after the first attempt so an absent file costs one pcall per game.
 */

const MAX_NOTES_CHARS = 400;

let cached: string | undefined;

export function MemoryNotes(): string {
	if (cached !== undefined) {
		return cached;
	}
	cached = ReadNotes();
	return cached;
}

function ReadNotes(): string {
	const [ok, mod] = pcall(require, "game/Customize/memory");
	if (!ok || type(mod) !== "table") {
		return "";
	}
	const notes: string = mod.notes;
	if (type(notes) !== "string" || notes === "") {
		return "";
	}
	return notes.slice(0, MAX_NOTES_CHARS);
}
