--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
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
local ReadNotes, MAX_NOTES_CHARS
function ReadNotes()
    local ok, mod = pcall(require, "game/Customize/memory")
    if not ok or type(mod) ~= "table" then
        return ""
    end
    local notes = mod.notes
    if type(notes) ~= "string" or notes == "" then
        return ""
    end
    return __TS__StringSlice(notes, 0, MAX_NOTES_CHARS)
end
MAX_NOTES_CHARS = 400
local cached
function ____exports.MemoryNotes()
    if cached ~= nil then
        return cached
    end
    cached = ReadNotes()
    return cached
end
return ____exports
