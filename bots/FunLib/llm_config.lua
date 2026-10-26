--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
local function DefaultConfig()
    return {
        Enable = true,
        Endpoint = "https://api.groq.com/openai/v1/chat/completions",
        Model = "qwen/qwen3.8-27b",
        APIKey = "",
        TimeoutMs = 8000,
        MaxConcurrent = 1,
        Phases = {draft = true, builds = true, desire = false, chat = true}
    }
end
local function AsBool(value, fallback)
    if type(value) == "boolean" then
        return value
    end
    return fallback
end
local function AsString(value, fallback)
    if type(value) == "string" then
        return value
    end
    return fallback
end
local function AsNonEmptyString(value, fallback)
    if type(value) == "string" and value ~= "" then
        return value
    end
    return fallback
end
local function AsClampedNumber(value, fallback, min, max)
    if type(value) == "number" then
        return math.min(
            max,
            math.max(min, value)
        )
    end
    return fallback
end
local function MergeUserConfig(config, mod)
    config.Enable = AsBool(mod.Enable, config.Enable)
    config.Endpoint = AsNonEmptyString(mod.Endpoint, config.Endpoint)
    config.Model = AsNonEmptyString(mod.Model, config.Model)
    config.APIKey = AsString(mod.APIKey, config.APIKey)
    config.TimeoutMs = AsClampedNumber(mod.TimeoutMs, config.TimeoutMs, 1000, 60000)
    config.MaxConcurrent = AsClampedNumber(mod.MaxConcurrent, config.MaxConcurrent, 1, 4)
    if type(mod.Phases) == "table" then
        config.Phases.draft = AsBool(mod.Phases.draft, config.Phases.draft)
        config.Phases.builds = AsBool(mod.Phases.builds, config.Phases.builds)
        config.Phases.desire = AsBool(mod.Phases.desire, config.Phases.desire)
        config.Phases.chat = AsBool(mod.Phases.chat, config.Phases.chat)
    end
end
local cached
--- Loads (once) and returns the effective LLM config. Never throws.
function ____exports.GetLlmConfig()
    if cached ~= nil then
        return cached
    end
    local config = DefaultConfig()
    local ok, mod = pcall(require, "game/Customize/llm")
    if ok and type(mod) == "table" then
        MergeUserConfig(config, mod)
    end
    cached = config
    return cached
end
return ____exports
