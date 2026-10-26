--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]
-- Lua Library inline imports
local function __TS__ArrayFilter(self, callbackfn, thisArg)
    local result = {}
    local len = 0
    for i = 1, #self do
        if callbackfn(thisArg, self[i], i - 1, self) then
            len = len + 1
            result[len] = self[i]
        end
    end
    return result
end

local function __TS__ArrayFindIndex(self, callbackFn, thisArg)
    for i = 1, #self do
        if callbackFn(thisArg, self[i], i - 1, self) then
            return i - 1
        end
    end
    return -1
end

local function __TS__CountVarargs(...)
    return select("#", ...)
end

local function __TS__ArraySplice(self, ...)
    local args = {...}
    local len = #self
    local actualArgumentCount = __TS__CountVarargs(...)
    local start = args[1]
    local deleteCount = args[2]
    if start < 0 then
        start = len + start
        if start < 0 then
            start = 0
        end
    elseif start > len then
        start = len
    end
    local itemCount = actualArgumentCount - 2
    if itemCount < 0 then
        itemCount = 0
    end
    local actualDeleteCount
    if actualArgumentCount == 0 then
        actualDeleteCount = 0
    elseif actualArgumentCount == 1 then
        actualDeleteCount = len - start
    else
        actualDeleteCount = deleteCount or 0
        if actualDeleteCount < 0 then
            actualDeleteCount = 0
        end
        if actualDeleteCount > len - start then
            actualDeleteCount = len - start
        end
    end
    local out = {}
    for k = 1, actualDeleteCount do
        local from = start + k
        if self[from] ~= nil then
            out[k] = self[from]
        end
    end
    if itemCount < actualDeleteCount then
        for k = start + 1, len - actualDeleteCount do
            local from = k + actualDeleteCount
            local to = k + itemCount
            if self[from] then
                self[to] = self[from]
            else
                self[to] = nil
            end
        end
        for k = len - actualDeleteCount + itemCount + 1, len do
            self[k] = nil
        end
    elseif itemCount > actualDeleteCount then
        for k = len - actualDeleteCount, start + 1, -1 do
            local from = k + actualDeleteCount
            local to = k + itemCount
            if self[from] then
                self[to] = self[from]
            else
                self[to] = nil
            end
        end
    end
    local j = start + 1
    for i = 3, actualArgumentCount do
        self[j] = args[i]
        j = j + 1
    end
    for k = #self, len - actualDeleteCount + itemCount + 1, -1 do
        self[k] = nil
    end
    return out
end

local function __TS__ArraySlice(self, first, last)
    local len = #self
    first = first or 0
    if first < 0 then
        first = len + first
        if first < 0 then
            first = 0
        end
    else
        if first > len then
            first = len
        end
    end
    last = last or len
    if last < 0 then
        last = len + last
        if last < 0 then
            last = 0
        end
    else
        if last > len then
            last = len
        end
    end
    local out = {}
    first = first + 1
    last = last + 1
    local n = 1
    while first < last do
        out[n] = self[first]
        first = first + 1
        n = n + 1
    end
    return out
end
-- End of Lua Library inline imports
local ____exports = {}
local CACHE_CAP = 16
local TELEMETRY_CAP = 200
local KEY_SEP = "\n#OHA#\n"
function ____exports.BudgetKindFor(phase)
    return phase == "chat" and "chat" or "policy"
end
function ____exports.CacheKey(phase, system, user)
    return (((phase .. KEY_SEP) .. system) .. KEY_SEP) .. user
end
function ____exports.CreateGatewayCore(config, clock, transport)
    local Record, CachePut, Dispatch, HandleResponse, used, inflight, pending, cache, cacheOrder, events
    function Record(ev, phase, detail)
        events[#events + 1] = {
            at = clock(),
            ev = ev,
            phase = phase,
            detail = detail
        }
        if #events > TELEMETRY_CAP then
            table.remove(events, 1)
        end
    end
    function CachePut(key, text)
        if cache[key] == nil then
            cacheOrder[#cacheOrder + 1] = key
            if #cacheOrder > CACHE_CAP then
                local oldest = table.remove(cacheOrder, 1)
                if oldest ~= nil then
                    cache[oldest] = nil
                end
            end
        end
        cache[key] = {
            text = text,
            at = clock()
        }
    end
    function Dispatch()
        while #inflight < config.MaxConcurrent and #pending > 0 do
            local idx = __TS__ArrayFindIndex(
                pending,
                function(____, j) return j.kind == "policy" end
            )
            if idx < 0 then
                idx = 0
            end
            local job = __TS__ArraySplice(pending, idx, 1)[1]
            job.deadline = clock() + config.TimeoutMs / 1000
            local ____used_0, ____job_kind_1 = used, job.kind
            ____used_0[____job_kind_1] = ____used_0[____job_kind_1] + 1
            inflight[#inflight + 1] = job
            Record("dispatch", job.phase)
            local dispatched = job
            transport.Post(
                config.Endpoint,
                config.APIKey,
                config.Model,
                job.system,
                job.user,
                function(statusCode, contentText)
                    HandleResponse(dispatched.id, statusCode, contentText)
                end
            )
        end
    end
    function HandleResponse(id, statusCode, contentText)
        local idx = __TS__ArrayFindIndex(
            inflight,
            function(____, j) return j.id == id end
        )
        if idx < 0 then
            Record(
                "late-dropped",
                nil,
                "id-" .. tostring(id)
            )
            return
        end
        local job = __TS__ArraySplice(inflight, idx, 1)[1]
        if statusCode == 200 and contentText ~= "" then
            CachePut(
                ____exports.CacheKey(job.phase, job.system, job.user),
                contentText
            )
            Record("ok", job.phase)
            job.cb(true, contentText, "net")
        else
            local reason = "http-" .. tostring(statusCode)
            Record("fail", job.phase, reason)
            job.cb(false, contentText, "fallback", reason)
        end
        Dispatch()
    end
    local nextId = 1
    used = {policy = 0, chat = 0}
    inflight = {}
    pending = {}
    cache = {}
    cacheOrder = {}
    events = {}
    local function CacheGet(key, ttlSec)
        local entry = cache[key]
        if entry == nil then
            return nil
        end
        if clock() - entry.at > ttlSec then
            cache[key] = nil
            cacheOrder = __TS__ArrayFilter(
                cacheOrder,
                function(____, k) return k ~= key end
            )
            return nil
        end
        return entry.text
    end
    local function ExpireInflight(now)
        local still = {}
        for ____, job in ipairs(inflight) do
            if job.deadline < now then
                Record("timeout", job.phase)
                job.cb(false, "", "fallback", "timeout")
            else
                still[#still + 1] = job
            end
        end
        inflight = still
    end
    local function Pump()
        ExpireInflight(clock())
        Dispatch()
    end
    local function Ask(phase, system, user, ttlSec, cb)
        local kind = ____exports.BudgetKindFor(phase)
        if not config.Enable then
            Record("ask-rejected", phase, "disabled")
            cb(false, "", "fallback", "disabled")
            return
        end
        if not config.Phases[phase] then
            Record("ask-rejected", phase, "phase-off")
            cb(false, "", "fallback", "phase-off")
            return
        end
        if used[kind] >= config.MaxCalls[kind] then
            Record("ask-rejected", phase, "budget")
            cb(false, "", "fallback", "budget")
            return
        end
        local hit = CacheGet(
            ____exports.CacheKey(phase, system, user),
            ttlSec
        )
        if hit ~= nil then
            Record("ask-cache-hit", phase)
            cb(true, hit, "cache")
            return
        end
        local prior = __TS__ArrayFindIndex(
            pending,
            function(____, j) return j.phase == phase end
        )
        if prior >= 0 then
            local old = __TS__ArraySplice(pending, prior, 1)[1]
            Record("ask-superseded", phase)
            old.cb(false, "", "fallback", "superseded")
        end
        pending[#pending + 1] = {
            id = nextId,
            phase = phase,
            kind = kind,
            system = system,
            user = user,
            cb = cb,
            deadline = 0
        }
        nextId = nextId + 1
        Record("ask-queued", phase)
        Pump()
    end
    local function Enabled(phase)
        local kind = ____exports.BudgetKindFor(phase)
        return config.Enable == true and config.Phases[phase] == true and used[kind] < config.MaxCalls[kind]
    end
    local function Stats()
        return {
            usedPolicy = used.policy,
            usedChat = used.chat,
            inflight = #inflight,
            pending = #pending,
            cacheEntries = #cacheOrder,
            events = #events
        }
    end
    return {
        Enabled = Enabled,
        Ask = Ask,
        Pump = Pump,
        HandleResponse = HandleResponse,
        Stats = Stats,
        Telemetry = function() return __TS__ArraySlice(events) end
    }
end
return ____exports
