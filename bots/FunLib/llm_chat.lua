--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
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
local Gateway = require(GetScriptDirectory().."/FunLib/llm_gateway")
local ____fork_log = require(GetScriptDirectory().."/FunLib/fork_log")
local ForkLog = ____fork_log.ForkLog
local ____llm_chat_core = require(GetScriptDirectory().."/FunLib/llm_chat_core")
local BuildChatPrompts = ____llm_chat_core.BuildChatPrompts
local ChatLimiterConfigFor = ____llm_chat_core.ChatLimiterConfigFor
local SanitizeChatReply = ____llm_chat_core.SanitizeChatReply
local ShouldReply = ____llm_chat_core.ShouldReply
local ____llm_tools_core = require(GetScriptDirectory().."/FunLib/llm_tools_core")
local EnvelopeParse = ____llm_tools_core.EnvelopeParse
local ValidateToolCall = ____llm_tools_core.ValidateToolCall
local jsonlib = require(GetScriptDirectory().."/ts_libs/utils/json")
local limiter = {replies = 0, lastReplyAt = -999}
local inFlight = false
function ____exports.ChatEnabled()
    return Gateway.Enabled("chat")
end
function ____exports.ChatStatusLine()
    return ("replies=" .. tostring(limiter.replies)) .. (inFlight and " inflight" or "")
end
local function EmptyEnvelopeReply()
    return {reply = nil, toolCalls = {}}
end
local function TrimFences(text)
    local t = __TS__StringTrim(text)
    if string.sub(t, 1, 3) == "```" then
        local nl = (string.find(t, "\n", nil, true) or 0) - 1
        t = nl >= 0 and __TS__StringSlice(t, nl + 1) or string.sub(t, 4)
    end
    if #t >= 3 and __TS__StringSlice(t, #t - 3) == "```" then
        t = __TS__StringSlice(t, 0, #t - 3)
    end
    return __TS__StringTrim(t)
end
local function DecodeJson(text)
    if type(text) ~= "string" or text == "" then
        return nil
    end
    local ok, decoded = pcall(
        jsonlib.decode,
        TrimFences(text)
    )
    if not ok then
        return nil
    end
    return decoded
end
--- Parses and validates one model reply. A malformed envelope returns nothing
-- at all; otherwise reply and tool calls stay independent - a sanitized-away
-- reply never drops a validated call, and a rejected call never drops the
-- reply. Every rejected call is dropped individually.
function ____exports.EnvelopeResultFrom(text, roster)
    local envelope = EnvelopeParse(DecodeJson(text))
    if envelope == nil then
        return EmptyEnvelopeReply()
    end
    local reply = SanitizeChatReply(envelope.reply)
    local toolCalls = {}
    local rawCalls = envelope.tool_calls
    if rawCalls ~= nil then
        do
            local i = 0
            while i < #rawCalls do
                local res = ValidateToolCall(rawCalls[i + 1], roster)
                if res.ok then
                    toolCalls[#toolCalls + 1] = {tool = res.tool, args = {hero = res.hero, pos = res.pos}}
                end
                i = i + 1
            end
        end
    end
    return {reply = reply, toolCalls = toolCalls}
end
--- One chat ask that yields both the persona reply and validated tool calls.
-- "asked" means the gateway call is in flight and onResult will fire once;
-- "skipped" means the layer is off, a call is already in flight, or the dice
-- and cooldown said no - the caller keeps its local fallback.
function ____exports.MaybeReplyEnvelope(ctx, now, onResult)
    if not ____exports.ChatEnabled() or inFlight then
        return "skipped"
    end
    local roll = RandomFloat(0, 1)
    if not ShouldReply(
        limiter,
        now,
        roll,
        ChatLimiterConfigFor(ctx)
    ) then
        return "skipped"
    end
    inFlight = true
    local delivered = false
    local function deliver(result)
        if delivered then
            return
        end
        delivered = true
        onResult(result)
    end
    local prompts = BuildChatPrompts(ctx)
    local roster = {teamBotHeroes = ctx.teamBotHeroes, humanHeroes = ctx.humanHeroes}
    local okAsk, errAsk = pcall(function()
        Gateway.Ask(
            "chat",
            prompts.system,
            prompts.user,
            45,
            function(ok, text, via, reason)
                inFlight = false
                if not ok then
                    ForkLog((("[OHA-LLM] chat fallback via=" .. (via ~= nil and via or "n/a")) .. " reason=") .. (reason ~= nil and reason or "n/a"))
                    deliver(EmptyEnvelopeReply())
                    return
                end
                local result = ____exports.EnvelopeResultFrom(text, roster)
                if result.reply ~= nil or #result.toolCalls > 0 then
                    limiter.replies = limiter.replies + 1
                    limiter.lastReplyAt = now
                end
                deliver(result)
            end
        )
    end)
    if not okAsk then
        inFlight = false
        ForkLog("[OHA-LLM] chat ask threw: " .. tostring(errAsk))
        deliver(EmptyEnvelopeReply())
    end
    return "asked"
end
--- Legacy reply-only path; same limiter and ask, envelope reduced to its reply.
function ____exports.MaybeReply(ctx, now, onReply)
    local envelopeCtx = {
        botName = ctx.botName,
        hero = ctx.hero,
        team = ctx.team,
        minute = ctx.minute,
        kills = ctx.kills,
        deaths = ctx.deaths,
        assists = ctx.assists,
        netWorth = ctx.netWorth,
        difficulty = ctx.difficulty,
        speakerName = ctx.speakerName,
        speakerHero = ctx.speakerHero,
        message = ctx.message,
        identityHandle = ctx.identityHandle,
        archetype = ctx.archetype,
        toneHint = ctx.toneHint,
        catchphrases = ctx.catchphrases,
        chanceMultiplier = ctx.chanceMultiplier,
        cooldownMultiplier = ctx.cooldownMultiplier,
        teamBotHeroes = {},
        humanHeroes = {}
    }
    return ____exports.MaybeReplyEnvelope(
        envelopeCtx,
        now,
        function(result)
            onReply(result.reply)
        end
    )
end
return ____exports
