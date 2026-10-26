--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
end

local function __TS__StringIncludes(self, searchString, position)
    if not position then
        position = 1
    else
        position = position + 1
    end
    local index = string.find(self, searchString, position, true)
    return index ~= nil
end

local __TS__StringSplit
do
    local sub = string.sub
    local find = string.find
    function __TS__StringSplit(source, separator, limit)
        if limit == nil then
            limit = 4294967295
        end
        if limit == 0 then
            return {}
        end
        local result = {}
        local resultIndex = 1
        if separator == nil or separator == "" then
            for i = 1, #source do
                result[resultIndex] = sub(source, i, i)
                resultIndex = resultIndex + 1
            end
        else
            local currentPos = 1
            while resultIndex <= limit do
                local startPos, endPos = find(source, separator, currentPos, true)
                if not startPos then
                    break
                end
                result[resultIndex] = sub(source, currentPos, startPos - 1)
                resultIndex = resultIndex + 1
                currentPos = endPos + 1
            end
            if resultIndex <= limit then
                result[resultIndex] = sub(source, currentPos)
            end
        end
        return result
    end
end

local function __TS__StringSlice(self, start, ____end)
    if start == nil or start ~= start then
        start = 0
    end
    if ____end ~= ____end then
        ____end = 0
    end
    if start >= 0 then
        start = start + 1
    end
    if ____end ~= nil and ____end < 0 then
        ____end = ____end - 1
    end
    return string.sub(self, start, ____end)
end
-- End of Lua Library inline imports
local ____exports = {}
--- Pure core for LLM-driven bot chat (RFC-001 Workstream W).
-- 
-- Owns the human-persona system prompt, the reply sanitizer, and the reply
-- policy (cooldown / per-game cap / reply chance). No engine or HTTP calls
-- here - the binding (llm_chat.ts) supplies those - so every rule is
-- unit-testable. Mirrors the *_core.ts split used by the draft/build layer.
-- 
-- Safety rules (enforced by the sanitizer, not just the prompt): one line,
-- <= CHAT_MAX_LEN chars, no links, no prompt leakage ("system"/"instruction"
-- echo), and never an admission of being an AI (the prompt forbids it, the
-- sanitizer rejects replies that break character).
____exports.CHAT_MAX_LEN = 140
____exports.CHAT_COOLDOWN_SEC = 10
____exports.CHAT_REPLY_CHANCE = 1
--- Appended to every persona prompt: one ask must serve the reply and the
-- command surface (RFC-002 §6.1), so the model always answers in the same
-- envelope shape instead of free chat text.
local TOOL_CONTRACT = (((("Output exactly ONE JSON object and nothing else: " .. "{\"reply\": \"<chat line>\", \"tool_calls\": [{\"tool\": \"swap_lane\" | \"swap_position\", ") .. "\"args\": {\"hero\": \"<hero internal_name>\", \"lane\": \"safe\" | \"mid\" | \"off\" | \"pos\": 1-5}}]}. ") .. "swap_lane takes lane, swap_position takes pos 1-5, and hero is the npc_dota_hero_... id. ") .. "Set \"tool_calls\": [] when the message is not a command. ") .. "The reply string is your chat line only and follows the persona rules above: short, in character, never an AI admission."
local function NonEmpty(value)
    if value == nil then
        return ""
    end
    return __TS__StringTrim(value)
end
--- Identity voice clause for the system prompt; "" when no identity is set.
local function IdentityVoice(ctx)
    local handle = NonEmpty(ctx.identityHandle)
    local archetype = NonEmpty(ctx.archetype)
    local parts = {}
    if handle ~= "" and archetype ~= "" then
        parts[#parts + 1] = ((("You are " .. handle) .. ", a ") .. archetype) .. " player."
    elseif handle ~= "" then
        parts[#parts + 1] = ("You are " .. handle) .. "."
    elseif archetype ~= "" then
        parts[#parts + 1] = ("You are a " .. archetype) .. " player."
    end
    local phrases = {}
    local rawPhrases = ctx.catchphrases
    if rawPhrases ~= nil then
        do
            local i = 0
            while i < #rawPhrases do
                local phrase = NonEmpty(rawPhrases[i + 1])
                if phrase ~= "" then
                    phrases[#phrases + 1] = phrase
                end
                i = i + 1
            end
        end
    end
    if #phrases > 0 then
        parts[#parts + 1] = ("You sometimes use phrases like: " .. table.concat(phrases, " / ")) .. "."
    end
    local tone = NonEmpty(ctx.toneHint)
    if tone ~= "" then
        parts[#parts + 1] = ("Tone: " .. tone) .. "."
    end
    if #parts == 0 then
        return ""
    end
    return "Your voice: " .. table.concat(parts, " ")
end
--- Human-player persona: SEA server trash talk.
-- 
-- The style samples come from the dffesalbon/dota-2-toxic-chat-data dataset
-- (Hugging Face), filtered to lines that carry the SEA register without
-- slurs, threats, sexual content or family insults.
function ____exports.BuildChatPrompts(ctx)
    local system = {
        "You are a real human Dota 2 player on the SEA server, chatting with other players during a ranked match.",
        "You are cocky, sarcastic and funny. You banter and trash talk the way SEA players do, mixing English with Filipino, Indonesian or Malay slang (bobo, tanga, noob, anjir, wkwk, sial, ez, diff, lag, report).",
        "Hard limits: no racial, religious or homophobic slurs, no threats, no sexual talk, no insults about anyone's mother or family, nothing a normal ranked chat would get you banned for.",
        "Write ONE chat message only. Keep it short like real game chat: usually under 12 words, all lowercase is fine.",
        "Style samples from real SEA chat: \"report void and qop\" / \"trash offlane\" / \"why crying\" / \"mga tanga\" / \"u happy now\" / \"void you are really noob\" / \"he bitching about the lane\" / \"are u guys trash like the last team we faced\" / \"tang ina magquit kayo hahaha\" / \"ez mid\" / \"wkwk gg\".",
        "Reply in the SAME language the other player used.",
        "You are NOT an AI. Never mention being a bot, an AI, a script, or a language model. Stay in character at all times.",
        "No emojis, no links, no hashtags, no quotes around your message."
    }
    local voice = IdentityVoice(ctx)
    if voice ~= "" then
        system[#system + 1] = voice
    end
    system[#system + 1] = TOOL_CONTRACT
    local systemText = table.concat(system, " ")
    local speaker = ctx.speakerHero ~= nil and ctx.speakerHero ~= "" and ((ctx.speakerName .. " (") .. ctx.speakerHero) .. ")" or ctx.speakerName
    local lines = {
        ((((("You are " .. ctx.botName) .. " playing ") .. ctx.hero) .. " for ") .. ctx.team) .. ".",
        ((((((((((("Match: minute " .. tostring(ctx.minute)) .. ", your score ") .. tostring(ctx.kills)) .. "/") .. tostring(ctx.deaths)) .. "/") .. tostring(ctx.assists)) .. ", net worth ") .. tostring(ctx.netWorth)) .. " gold, bot difficulty ") .. ctx.difficulty) .. "."
    }
    local memoryTail = NonEmpty(ctx.memoryTail)
    if memoryTail ~= "" then
        lines[#lines + 1] = "Recent match events:\n" .. memoryTail
    end
    lines[#lines + 1] = ((speaker .. " said in chat: \"") .. ctx.message) .. "\""
    lines[#lines + 1] = ("Write your one-line reply as " .. ctx.botName) .. "."
    local user = table.concat(lines, "\n")
    return {system = systemText, user = user}
end
local function Contains(text, needle)
    return __TS__StringIncludes(text, needle)
end
local QUOTE_CHARS = "\"'“”"
local function IsQuote(ch)
    return __TS__StringIncludes(QUOTE_CHARS, ch)
end
local function LastSpaceBefore(s)
    local last = -1
    local pos = (string.find(s, " ", nil, true) or 0) - 1
    while pos ~= -1 do
        last = pos
        pos = (string.find(
            s,
            " ",
            math.max(pos + 1 + 1, 1),
            true
        ) or 0) - 1
    end
    return last
end
--- Rejects rule-breaking replies; returns undefined so callers fall back.
function ____exports.SanitizeChatReply(raw)
    if raw == nil or type(raw) ~= "string" then
        return nil
    end
    local line = __TS__StringSplit(raw, "\n")[1] or ""
    while #line > 0 and IsQuote(string.sub(line, 1, 1)) do
        line = string.sub(line, 2)
    end
    while #line > 0 and IsQuote(__TS__StringSlice(line, #line - 1)) do
        line = __TS__StringSlice(line, 0, #line - 1)
    end
    line = table.concat(
        __TS__StringSplit(line, "\""),
        "'"
    )
    line = __TS__StringTrim(line)
    if #line < 2 or #line > 400 then
        return nil
    end
    local lower = string.lower(line)
    if Contains(lower, "http") or Contains(lower, "www.") then
        return nil
    end
    if Contains(lower, "as an ai") or Contains(lower, "language model") or Contains(lower, "i am a bot") or Contains(lower, "i'm a bot") then
        return nil
    end
    if #line > ____exports.CHAT_MAX_LEN then
        local cut = __TS__StringSlice(line, 0, ____exports.CHAT_MAX_LEN)
        local spaceAt = LastSpaceBefore(cut)
        line = __TS__StringTrim(spaceAt > 40 and __TS__StringSlice(cut, 0, spaceAt) or cut) .. "..."
    end
    return line
end
--- Effective reply chance never drops below this, whatever the weighting.
____exports.CHAT_MIN_CHANCE = 0.05
____exports.CHAT_MAX_CHANCE = 1
____exports.DEFAULT_CHAT_LIMITER = {cooldownSec = ____exports.CHAT_COOLDOWN_SEC, chance = ____exports.CHAT_REPLY_CHANCE}
--- Defaults plus this bot's identity weighting, if any.
function ____exports.ChatLimiterConfigFor(ctx)
    return {cooldownSec = ____exports.DEFAULT_CHAT_LIMITER.cooldownSec, chance = ____exports.DEFAULT_CHAT_LIMITER.chance, chanceMultiplier = ctx.chanceMultiplier, cooldownMultiplier = ctx.cooldownMultiplier}
end
local function EffectiveChance(config)
    if config.chanceMultiplier == nil then
        return config.chance
    end
    local scaled = config.chance * config.chanceMultiplier
    if scaled < ____exports.CHAT_MIN_CHANCE then
        return ____exports.CHAT_MIN_CHANCE
    end
    if scaled > ____exports.CHAT_MAX_CHANCE then
        return ____exports.CHAT_MAX_CHANCE
    end
    return scaled
end
local function EffectiveCooldown(config)
    if config.cooldownMultiplier == nil then
        return config.cooldownSec
    end
    return config.cooldownSec * config.cooldownMultiplier
end
--- Pure reply decision. `roll` is a 0..1 random supplied by the binding so
-- tests are deterministic. No per-game cap: trash talk stays on all game.
function ____exports.ShouldReply(state, now, roll, config)
    if config == nil then
        config = ____exports.DEFAULT_CHAT_LIMITER
    end
    if now - state.lastReplyAt < EffectiveCooldown(config) then
        return false
    end
    return roll < EffectiveChance(config)
end
return ____exports
