--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
--- Console logger for the fork's LLM layer.
-- 
-- FretBots/Debug.lua replaces global `print` with a no-op unless its own debug
-- flag is on, and FretBots now auto-starts at hero selection — so a plain
-- `print` from the LLM modules would vanish for the whole draft. MsgN writes
-- to the console directly and is not affected by that override.
function ____exports.ForkLog(message)
    pcall(print, message)
    pcall(MsgN, message)
end
return ____exports
