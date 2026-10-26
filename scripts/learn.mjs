#!/usr/bin/env node
/**
 * scripts/learn.mjs - offline learning pass for OHA-LLM telemetry (RFC-002 Phase D / T7).
 *
 * Usage:
 *   node scripts/learn.mjs <path-to-console.log>
 *
 * Reads a Dota console log captured with -condebug, pulls the [OHA-LLM] markers
 * (draft picks/bans, applied builds, strategy stances, bot identities) plus any
 * match-result line, and folds them into game/Customize/memory.lua:
 *
 *   return { games = 3, notes = "game 3; picks: axe,luna; stance: split-push@15m" }
 *
 * game/Customize is gitignored on purpose; the file lands in the permanent
 * customization tier and is picked up by the next match.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '[OHA-LLM]';
const MAX_NOTES = 400;
const MEMORY_PATH = join(
	resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	'game',
	'Customize',
	'memory.lua'
);

// Everything outside this set is replaced by a space before it reaches the Lua file.
const ALLOWED_NOTES_CHARS = /[^A-Za-z0-9 ,.:;_@()+'%\/-]/g;

function usage() {
	process.stderr.write('usage: node scripts/learn.mjs <path-to-console.log>\n');
	process.stderr.write('  reads [OHA-LLM] lines from a -condebug console.log and writes game/Customize/memory.lua\n');
}

function shortHero(raw) {
	let name = String(raw).trim().toLowerCase();
	if (name.startsWith('npc_dota_hero_')) name = name.slice('npc_dota_hero_'.length);
	return name.replace(/[^a-z0-9_]/g, '').slice(0, 12);
}

function heroList(text) {
	const out = [];
	const seen = new Set();
	for (const chunk of String(text).split(/[,\s]+/)) {
		const hero = shortHero(chunk);
		if (!hero || hero === 'picks' || hero === 'bans' || seen.has(hero)) continue;
		seen.add(hero);
		out.push(hero);
	}
	return out;
}

function sanitizeNotes(text) {
	return String(text).replace(ALLOWED_NOTES_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract what the log says, without deciding how it is worded in the notes.
 * Only [OHA-LLM] lines are scanned for draft/build/strategy/identity events; the
 * match-result marker is engine text and never carries the tag.
 */
function parseLog(text) {
	const picks = [];
	const bans = [];
	const stances = [];
	const identities = [];
	let buildCount = 0;
	let result = '';
	let markerLines = 0;
	let totalLines = 0;

	for (const rawLine of text.split(/\r?\n/)) {
		if (rawLine.trim() === '') continue;
		totalLines++;

		if (!rawLine.includes(MARKER)) {
			if (result === '') {
				const res = rawLine.match(/\b(radiant|dire)\b(?:\s+\w+){0,3}\s+\b(win|wins|won|victor\w*)\b/i);
				if (res) {
					const outcome = res[2].toLowerCase().startsWith('victor') ? 'victory' : 'win';
					result = `${res[1].toLowerCase()} ${outcome}`;
				}
			}
			continue;
		}
		markerLines++;

		const replyAt = rawLine.indexOf('draft reply OK:');
		if (replyAt !== -1) {
			const rest = rawLine.slice(replyAt + 'draft reply OK:'.length);
			const bannedAt = rest.indexOf('|');
			const pickPart = bannedAt === -1 ? rest : rest.slice(0, bannedAt);
			const banPart = bannedAt === -1 ? '' : rest.slice(bannedAt + 1);
			for (const hero of heroList(pickPart.replace(/picks/i, ' '))) picks.push(hero);
			for (const hero of heroList(banPart.replace(/bans/i, ' '))) bans.push(hero);
			continue;
		}

		if (rawLine.includes('build applied')) {
			buildCount++;
			continue;
		}

		const stance = rawLine.match(/strategy @(\d+)m:\s*([^,;|(]+)/);
		if (stance) {
			const name = sanitizeNotes(stance[2]).slice(0, 16).trim();
			if (name !== '') stances.push({ minute: Number(stance[1]), stance: name });
			continue;
		}

		const identity = rawLine.match(/identity ([A-Za-z0-9_@.\-]+)/);
		if (identity) identities.push(identity[1].slice(0, 16));
	}

	return { picks, bans, stances, identities, buildCount, result, markerLines, totalLines };
}

function rank(values) {
	const seen = new Map();
	for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
	return [...seen.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([value]) => value);
}

function dominantStances(stances, limit) {
	const first = new Map();
	const counts = new Map();
	for (const entry of stances) {
		counts.set(entry.stance, (counts.get(entry.stance) ?? 0) + 1);
		if (!first.has(entry.stance)) first.set(entry.stance, entry.minute);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || first.get(a[0]) - first.get(b[0]))
		.slice(0, limit)
		.map(([stance]) => `${stance}@${first.get(stance)}m`);
}

/** Join note segments in priority order so the 400-char cap trims the least useful tail. */
function composeNotes(segments) {
	const kept = [];
	let total = 0;
	for (const segment of segments) {
		if (!segment) continue;
		const cost = segment.length + (kept.length === 0 ? 0 : 2);
		if (total + cost > MAX_NOTES) continue;
		kept.push(segment);
		total += cost;
	}
	return sanitizeNotes(kept.join('; ')).slice(0, MAX_NOTES);
}

function buildNotes(scanned, games) {
	const parts = [`game ${games}`];
	if (scanned.result) parts.push(`result: ${scanned.result}`);

	const picks = rank(scanned.picks).slice(0, 6);
	if (picks.length > 0) parts.push(`picks: ${picks.join(',')}`);

	const stances = dominantStances(scanned.stances, 2);
	if (stances.length > 0) parts.push(`stance: ${stances.join(',')}`);

	const bans = rank(scanned.bans).slice(0, 4);
	if (bans.length > 0) parts.push(`bans: ${bans.join(',')}`);

	if (scanned.buildCount > 0) parts.push(`builds: ${scanned.buildCount}`);
	if (scanned.identities.length > 0) parts.push(`ids: ${rank(scanned.identities).slice(0, 3).join(',')}`);

	return composeNotes(parts);
}

/** Previous state, or an empty record when the file does not exist yet. */
function readPrevious() {
	if (!existsSync(MEMORY_PATH)) return { games: 0, notes: '' };
	const text = readFileSync(MEMORY_PATH, 'utf8');
	const games = text.match(/\bgames\s*=\s*(\d+)/);
	const notes = text.match(/\bnotes\s*=\s*"((?:[^"\\]|\\.)*)"/);
	const raw = notes ? notes[1].replace(/\\(.)/g, '$1') : '';
	return { games: games ? Number(games[1]) : 0, notes: sanitizeNotes(raw) };
}

function luaString(text) {
	return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

/** Keep the old notes but move their leading game stamp to the game we just counted. */
function restampGame(notes, games) {
	return sanitizeNotes(notes.replace(/^game \d+/, `game ${games}`)).slice(0, MAX_NOTES);
}

function writeMemory(games, notes) {
	mkdirSync(dirname(MEMORY_PATH), { recursive: true });
	const body = `return { games = ${games}, notes = "${luaString(notes)}" }\n`;
	writeFileSync(MEMORY_PATH, body, 'utf8');
}

function main() {
	const logPath = process.argv[2];
	if (!logPath) {
		usage();
		process.exit(1);
	}

	const resolvedLog = resolve(logPath);
	if (!existsSync(resolvedLog)) {
		process.stderr.write(`learn: log not found: ${resolvedLog}\n`);
		process.stderr.write('learn: pass a Dota console.log captured with -condebug; nothing written\n');
		process.exit(1);
	}

	const text = readFileSync(resolvedLog, 'utf8');
	const scanned = parseLog(text);
	const previous = readPrevious();
	const hadPreviousFile = existsSync(MEMORY_PATH);
	const games = previous.games + 1;

	if (scanned.markerLines === 0) {
		process.stdout.write(`learn: WARNING no "${MARKER}" lines in ${resolvedLog}\n`);
		if (!hadPreviousFile) {
			process.stdout.write('learn: no previous memory.lua, nothing written (notes would be empty)\n');
			return;
		}
		if (previous.notes === '') {
			process.stdout.write('learn: previous memory.lua has empty notes, nothing written\n');
			return;
		}
		const keptNote = restampGame(previous.notes, games);
		writeMemory(games, keptNote);
		process.stdout.write(
			`learn: kept previous notes (${keptNote.length} chars), games ${previous.games} -> ${games} (${games} total)\n`
		);
		process.stdout.write(`learn: wrote ${MEMORY_PATH}\n`);
		return;
	}

	const notes = buildNotes(scanned, games);
	if (notes === '') {
		process.stdout.write('learn: WARNING nothing usable found, nothing written\n');
		return;
	}

	writeMemory(games, notes);
	process.stdout.write(`learn: log ${resolvedLog}\n`);
	process.stdout.write(
		`learn: scanned ${scanned.totalLines} lines, ${scanned.markerLines} ${MARKER} lines ` +
		`(picks ${scanned.picks.length}, bans ${scanned.bans.length}, stances ${scanned.stances.length}, ` +
		`builds ${scanned.buildCount}, identities ${scanned.identities.length})\n`
	);
	process.stdout.write(`learn: result ${scanned.result === '' ? 'not found' : scanned.result}\n`);
	process.stdout.write(
		`learn: notes ${notes.length}/${MAX_NOTES} chars, games ${previous.games} -> ${games} (${games} total)\n`
	);
	process.stdout.write(`learn: wrote ${MEMORY_PATH}\n`);
}

main();
