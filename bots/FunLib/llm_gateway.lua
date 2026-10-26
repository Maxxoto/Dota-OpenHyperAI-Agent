--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
local ____exports = {}
local ____llm_config = require(GetScriptDirectory().."/FunLib/llm_config")
local GetLlmConfig = ____llm_config.GetLlmConfig
local ____llm_gateway_core = require(GetScriptDirectory().."/FunLib/llm_gateway_core")
local CreateGatewayCore = ____llm_gateway_core.CreateGatewayCore
local jsonlib = require(GetScriptDirectory().."/ts_libs/utils/json")
local masterFlag
local function MasterEnabled()
    if masterFlag ~= nil then
        return masterFlag
    end
    masterFlag = false
    local ok, customize = pcall(
        require,
        GetScriptDirectory() .. "/FunLib/custom_loader"
    )
    if ok and type(customize) == "table" and customize.Allow_LLM_Advisor == true then
        masterFlag = true
    end
    return masterFlag
end
local transport = {Post = function(url, apiKey, model, system, user, respond)
    local payload = jsonlib.encode({model = model, messages = {{role = "system", content = system}, {role = "user", content = user}}, temperature = 0.4})
    local req = CreateHTTPRequest("POST", url)
    req:SetHTTPRequestHeaderValue("Content-Type", "application/json")
    if apiKey ~= "" then
        req:SetHTTPRequestHeaderValue("Authorization", "Bearer " .. apiKey)
    end
    req:SetHTTPRequestRawPostBody("application/json", payload)
    req:Send(function(response)
        if response == nil or type(response) ~= "table" or response.StatusCode ~= 200 then
            local ____temp_0
            if response ~= nil and type(response) == "table" then
                ____temp_0 = response.StatusCode
            else
                ____temp_0 = 0
            end
            local status = ____temp_0
            respond(status, "")
            return
        end
        local ok, parsed = pcall(jsonlib.decode, response.Body)
        if not ok or type(parsed) ~= "table" or type(parsed.choices) ~= "table" or type(parsed.choices[1]) ~= "table" then
            respond(200, "")
            return
        end
        local choice = parsed.choices[1]
        if type(choice.message) == "table" and type(choice.message.content) == "string" then
            respond(200, choice.message.content)
        else
            respond(200, "")
        end
    end)
end}
local core
local function Core()
    if core == nil then
        core = CreateGatewayCore(
            GetLlmConfig(),
            GameTime,
            transport
        )
    end
    return core
end
--- Ask the LLM. cb receives exactly one result (net/cache/fallback).
function ____exports.Ask(phase, system, user, ttlSec, cb)
    if not MasterEnabled() then
        cb(false, "", "fallback", "master-off")
        return
    end
    Core().Ask(
        phase,
        system,
        user,
        ttlSec,
        cb
    )
end
--- Whether a phase could dispatch right now (for !llm status).
function ____exports.Enabled(phase)
    return MasterEnabled() and Core().Enabled(phase)
end
function ____exports.Stats()
    return Core().Stats()
end
function ____exports.Telemetry()
    return Core().Telemetry()
end
--- One-line status for the in-game !llm chat command.
function ____exports.StatusLine()
    local config = GetLlmConfig()
    local stats = Core().Stats()
    return (((((((("[OHA-LLM] master=" .. tostring(MasterEnabled())) .. " enable=") .. tostring(config.Enable)) .. " model=") .. config.Model) .. " ") .. ((("calls(p/c)=" .. tostring(stats.usedPolicy)) .. "/") .. tostring(stats.usedChat)) .. " ") .. ((("budget=" .. tostring(config.MaxCalls.policy)) .. "/") .. tostring(config.MaxCalls.chat)) .. " ") .. (((("inflight=" .. tostring(stats.inflight)) .. " pending=") .. tostring(stats.pending)) .. " cache=") .. tostring(stats.cacheEntries)
end
return ____exports
