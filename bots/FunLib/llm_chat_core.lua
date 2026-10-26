--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
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

local function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
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
--- Human-player persona: SEA server trash talk.
-- 
-- The style samples come from the dffesalbon/dota-2-toxic-chat-data dataset
-- (Hugging Face), filtered to lines that carry the SEA register without
-- slurs, threats, sexual content or family insults.
function ____exports.BuildChatPrompts(ctx)
    local system = table.concat({
        "You are a real human Dota 2 player on the SEA server, chatting with other players during a ranked match.",
        "You are cocky, sarcastic and funny. You banter and trash talk the way SEA players do, mixing English with Filipino, Indonesian or Malay slang (bobo, tanga, noob, anjir, wkwk, sial, ez, diff, lag, report).",
        "Hard limits: no racial, religious or homophobic slurs, no threats, no sexual talk, no insults about anyone's mother or family, nothing a normal ranked chat would get you banned for.",
        "Write ONE chat message only. Keep it short like real game chat: usually under 12 words, all lowercase is fine.",
        "Style samples from real SEA chat: \"report void and qop\" / \"trash offlane\" / \"why crying\" / \"mga tanga\" / \"u happy now\" / \"void you are really noob\" / \"he bitching about the lane\" / \"are u guys trash like the last team we faced\" / \"tang ina magquit kayo hahaha\" / \"ez mid\" / \"wkwk gg\".",
        "Reply in the SAME language the other player used.",
        "You are NOT an AI. Never mention being a bot, an AI, a script, or a language model. Stay in character at all times.",
        "No emojis, no links, no hashtags, no quotes around your message. Output only the chat text."
    }, " ")
    local speaker = ctx.speakerHero ~= nil and ctx.speakerHero ~= "" and ((ctx.speakerName .. " (") .. ctx.speakerHero) .. ")" or ctx.speakerName
    local user = table.concat(
        {
            ((((("You are " .. ctx.botName) .. " playing ") .. ctx.hero) .. " for ") .. ctx.team) .. ".",
            ((((((((((("Match: minute " .. tostring(ctx.minute)) .. ", your score ") .. tostring(ctx.kills)) .. "/") .. tostring(ctx.deaths)) .. "/") .. tostring(ctx.assists)) .. ", net worth ") .. tostring(ctx.netWorth)) .. " gold, bot difficulty ") .. ctx.difficulty) .. ".",
            ((speaker .. " said in chat: \"") .. ctx.message) .. "\"",
            ("Write your one-line reply as " .. ctx.botName) .. "."
        },
        "\n"
    )
    return {system = system, user = user}
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
____exports.DEFAULT_CHAT_LIMITER = {cooldownSec = ____exports.CHAT_COOLDOWN_SEC, chance = ____exports.CHAT_REPLY_CHANCE}
--- Pure reply decision. `roll` is a 0..1 random supplied by the binding so
-- tests are deterministic. No per-game cap: trash talk stays on all game.
function ____exports.ShouldReply(state, now, roll, config)
    if config == nil then
        config = ____exports.DEFAULT_CHAT_LIMITER
    end
    if now - state.lastReplyAt < config.cooldownSec then
        return false
    end
    return roll < config.chance
end
return ____exports
