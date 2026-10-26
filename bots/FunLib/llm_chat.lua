--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
local Gateway = require(GetScriptDirectory().."/FunLib/llm_gateway")
local ____fork_log = require(GetScriptDirectory().."/FunLib/fork_log")
local ForkLog = ____fork_log.ForkLog
local ____llm_chat_core = require(GetScriptDirectory().."/FunLib/llm_chat_core")
local BuildChatPrompts = ____llm_chat_core.BuildChatPrompts
local SanitizeChatReply = ____llm_chat_core.SanitizeChatReply
local ShouldReply = ____llm_chat_core.ShouldReply
local limiter = {replies = 0, lastReplyAt = -999}
local inFlight = false
function ____exports.ChatEnabled()
    return Gateway.Enabled("chat")
end
function ____exports.ChatStatusLine()
    return ("replies=" .. tostring(limiter.replies)) .. (inFlight and " inflight" or "")
end
function ____exports.MaybeReply(ctx, now, onReply)
    if not ____exports.ChatEnabled() or inFlight then
        return "skipped"
    end
    local roll = RandomFloat(0, 1)
    if not ShouldReply(limiter, now, roll) then
        return "skipped"
    end
    inFlight = true
    local prompts = BuildChatPrompts(ctx)
    Gateway.Ask(
        "chat",
        prompts.system,
        prompts.user,
        45,
        function(ok, text, via, reason)
            inFlight = false
            if not ok then
                ForkLog((("[OHA-LLM] chat fallback via=" .. via) .. " reason=") .. (reason ~= nil and reason or "n/a"))
                onReply(nil, via, reason)
                return
            end
            local reply = SanitizeChatReply(text)
            if reply ~= nil then
                limiter.replies = limiter.replies + 1
                limiter.lastReplyAt = now
            end
            onReply(reply)
        end
    )
    return "asked"
end
return ____exports
