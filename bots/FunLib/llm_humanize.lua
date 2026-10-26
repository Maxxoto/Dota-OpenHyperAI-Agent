--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
local ____llm_humanize_core = require(GetScriptDirectory().."/FunLib/llm_humanize_core")
local ProfileFor = ____llm_humanize_core.ProfileFor
local SampleLatency = ____llm_humanize_core.SampleLatency
local cached
local function Gate()
    if cached ~= nil then
        return cached
    end
    local on = false
    local tier = "guardian"
    local ok, customize = pcall(
        require,
        GetScriptDirectory() .. "/FunLib/custom_loader"
    )
    if ok and type(customize) == "table" then
        on = customize.Allow_Humanized_Gameplay == true
        local raw = customize.Humanize_Tier
        if raw == "herald" or raw == "guardian" or raw == "legend" then
            tier = raw
        end
    end
    cached = {on = on, tier = tier}
    return cached
end
--- Signed last-hit timing error in seconds; 0 when the layer is off.
function ____exports.LastHitDelayJitter()
    local gate = Gate()
    if not gate.on then
        return 0
    end
    local profile = ProfileFor(gate.tier)
    local lo, hi = unpack(profile.lastHitJitterSec)
    local sampled = SampleLatency(
        profile,
        "lastHit",
        RandomFloat(0, 1)
    )
    return sampled - (lo + hi) / 2
end
return ____exports
