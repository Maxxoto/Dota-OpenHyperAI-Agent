--[[
    Live LLM round-trip test WITHOUT Dota 2 (plan task T4+, user-requested).

    Runs the REAL generated Lua pipeline under LuaJIT:
      llm_state (gather) -> llm_state_core (prompt+budget) -> llm_gateway (HTTP)
      -> live LLM -> llm_directive_core (validate) -> directive -> cache check

    The engine's CreateHTTPRequest is shimmed onto curl. Config lives in
    /tmp/oha-live (gitignored territory; the repo is never touched).

    Usage (from the repo root):
      cp .env.example .env   # then edit .env with your key  (gitignored)
      luajit test/live_roundtrip.lua
      Or inline: GROQ_API_KEY=gsk_... GROQ_MODEL=qwen/qwen3.8-27b luajit test/live_roundtrip.lua
      (no key -> auto-detects a local Ollama at 127.0.0.1:11434; prefers a qwen model)

    Requires: luajit, curl. Exit 0 = pass, 1 = pipeline failure, 2 = no provider.
]]

-- dotenv loader: a repo-root .env file (gitignored) supplies defaults;
-- real environment variables always win (dotenv convention).
local env = {}
do
    local f = io.open(".env", "r")
    if f then
        for line in f:lines() do
            local k, v = line:match("^%s*(%a[%w_]*)%s*=%s*(.-)%s*$")
            if k and v ~= "" then
                local q = v:sub(1, 1)
                if (q == '"' or q == "'") and v:sub(-1) == q then
                    v = v:sub(2, -2)
                end
                env[k] = v
            end
        end
        f:close()
    end
end
local function getEnv(name)
    return os.getenv(name) or env[name]
end

local key = getEnv("GROQ_API_KEY") or ""
local endpoint, model
if key ~= "" then
    endpoint = "https://api.groq.com/openai/v1/chat/completions"
    model = getEnv("GROQ_MODEL") or "qwen/qwen3.8-27b"
else
    local p = io.popen("curl -s -m 2 http://127.0.0.1:11434/api/tags")
    local out = p and p:read("*a") or ""
    if p then p:close() end
    local names = {}
    for name in out:gmatch('"name"%s*:%s*"([^"]+)"') do names[#names + 1] = name end
    if #names == 0 then
        print("[LIVE] No GROQ_API_KEY set and no Ollama found at 127.0.0.1:11434.")
        print("[LIVE] Option 1: GROQ_API_KEY=gsk_... GROQ_MODEL=<id> luajit test/live_roundtrip.lua")
        print("[LIVE]   (free key + current model ids: https://console.groq.com)")
        print("[LIVE] Option 2: install Ollama (https://ollama.com) then: ollama pull qwen2.5:14b")
        os.exit(2)
    end
    endpoint = "http://127.0.0.1:11434/v1/chat/completions"
    model = names[1]
    for _, n in ipairs(names) do
        if n:find("qwen", 1, true) then model = n break end
    end
end

local repoConfig = io.open("bots/FunLib/llm_directive.lua", "r")
if repoConfig then repoConfig:close() else
    print("[LIVE] run this from the repo root: luajit test/live_roundtrip.lua")
    os.exit(1)
end

-- ---- engine stubs (frozen GameTime keeps both asks' prompts identical -> cache hit) ----
GetScriptDirectory = function() return "bots" end
GameTime = function() return 300 end
GetGameMode = function() return 3 end
local heroesByPlayer = { [0] = "npc_dota_hero_axe", [5] = "npc_dota_hero_phantom_assassin" }
GetSelectedHeroName = function(pId) return heroesByPlayer[pId] or "" end
PlayerResource = {
    GetPlayerCount = function(self) return 10 end,
    IsValidPlayerID = function(self, id) return id >= 0 and id < 10 end,
    GetTeam = function(self, id) return id < 5 and 2 or 3 end,
    GetLevel = function(self, id) return 1 + id end,
    GetNetWorth = function(self, id) return 600 * (id + 1) end,
    GetKills = function(self, id) return 0 end,
    GetDeaths = function(self, id) return 0 end,
    GetAssists = function(self, id) return 0 end,
}

-- ---- CreateHTTPRequest shim onto curl (synchronous; the gateway is callback-agnostic) ----
local httpCalls = 0
local lastBody = ""
local function shq(s) return "'" .. s:gsub("'", "'\\''") .. "'" end

CreateHTTPRequest = function(method, url)
    local h = { headers = {} }
    h.SetHTTPRequestHeaderValue = function(self, k, v) h.headers[k] = v end
    h.SetHTTPRequestRawPostBody = function(self, ct, body) h.body = body end
    h.Send = function(self, cb)
        httpCalls = httpCalls + 1
        local tmp = os.tmpname()
        local f = assert(io.open(tmp, "w"))
        f:write(h.body or "")
        f:close()
        local cmd = "curl -s -m 60 -X POST " .. shq(url)
        for k, v in pairs(h.headers) do
            cmd = cmd .. " -H " .. shq(k .. ": " .. v)
        end
        cmd = cmd .. " --data-binary @" .. shq(tmp) .. ' -w "\\n%{http_code}"'
        local p = io.popen(cmd, "r")
        local out = p and p:read("*a") or ""
        if p then p:close() end
        os.remove(tmp)
        lastBody = out
        local body, status = out:match("^(.*)\n(%d+)%s*$")
        cb({ StatusCode = tonumber(status or "0") or 0, Body = body or out })
    end
    return h
end

-- ---- isolated config (never touches the repo; game/Customize is gitignored anyway) ----
os.execute("mkdir -p /tmp/oha-live/game/Customize")
local function writeCfg(path, content)
    local f = assert(io.open(path, "w"))
    f:write(content)
    f:close()
end
writeCfg("/tmp/oha-live/game/Customize/general.lua", "return { Enable = true, Allow_LLM_Advisor = true }\n")
writeCfg(
    "/tmp/oha-live/game/Customize/llm.lua",
    string.format(
        "return { Enable = true, Endpoint = %q, Model = %q, APIKey = %q, TimeoutMs = 60000 }\n",
        endpoint, model, key
    )
)
package.path = "/tmp/oha-live/?.lua;./?.lua;" .. package.path

local D = dofile("bots/FunLib/llm_directive.lua")
print(("[LIVE] provider=%s model=%s apiKey=%s"):format(
    endpoint:find("groq", 1, true) and "groq" or "ollama",
    model,
    key ~= "" and "(set)" or "(local, none needed)"
))

local FACTS = {
    candidates = {
        { hero = "npc_dota_hero_legion_commander", score = 0.72 },
        { hero = "npc_dota_hero_sand_king", score = 0.66 },
        { hero = "npc_dota_hero_necrolyte", score = 0.61 },
    },
    bans = { "npc_dota_hero_tinker" },
}
local NOTES = "human is practicing Phantom Assassin; they fed twice in lane"

local t0 = os.clock()
local directive
D.AskDraftDirective(FACTS, NOTES, function(d) directive = d end)

if directive == nil then
    print("[LIVE] FAIL: pipeline fell back (see [OHA-LLM] lines above for the reason).")
    print("[LIVE] raw HTTP response (first 600 chars):")
    print(lastBody:sub(1, 600))
    if lastBody:find("decommissioned", 1, true) or lastBody:find("not_found", 1, true)
        or lastBody:find("model", 1, true) then
        print("[LIVE] hint: model id may be wrong/retired - grab a current one from")
        print("[LIVE]       https://console.groq.com/docs and rerun with GROQ_MODEL=<id>")
    end
    os.exit(1)
end

local builds = 0
for _ in pairs(directive.builds) do builds = builds + 1 end
print(("[LIVE] accepted in %.1fs: %d picks, %d bans, %d builds, %d warnings"):format(
    os.clock() - t0, #directive.picks, #directive.bans, builds, #directive.warnings
))
for _, p in ipairs(directive.picks) do
    print(("  pick  %-40s w=%.2f  %s"):format(p.hero, p.weight, p.reason or ""))
end
for _, b in ipairs(directive.bans) do
    print(("  ban   %-40s w=%.2f"):format(b.hero, b.weight))
end
for hero, bld in pairs(directive.builds) do
    print(("  build %-40s pos=%d items=%s"):format(hero, bld.pos, table.concat(bld.items, ", ")))
end
for _, w in ipairs(directive.warnings) do
    print("  warn  " .. w)
end
if #directive.picks == 0 then
    print("[LIVE] FAIL: directive accepted but contains no picks")
    os.exit(1)
end

local callsBefore = httpCalls
local second
D.AskDraftDirective(FACTS, NOTES, function(d) second = d end)
if httpCalls ~= callsBefore then
    print("[LIVE] FAIL: identical second ask hit HTTP again (cache miss)")
    os.exit(1)
end
if second == nil then
    print("[LIVE] FAIL: second ask returned no cached directive")
    os.exit(1)
end
print("[LIVE] second identical ask served from cache (0 extra HTTP calls)")
print("[LIVE] PASS - full pipeline works against a live model, no Dota needed")
os.exit(0)
