// AP Timing live bridge: reads the MyLaps scoreboard feed (TCP) and keeps the app's live results up to date.
// Run on a PC on the timing network:   node live-bridge.js [config.json]
"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const { FeedState } = require("./parseFeed");

function createBridge({ cfg, rpc, log = console.log, connect = (h, p) => net.connect(p, h) }) {
  const state = new FeedState();
  const quietMs = (cfg.liveTimeoutMinutes ?? 5) * 60000;
  const pushEvery = (cfg.pushEverySeconds ?? 2) * 1000;
  const rawLog = cfg.saveRaw ? path.join(__dirname, "feed-raw.log") : null;
  let lastStatus = 0, statusFailed = false, lastChangeAt = Date.now(), ended = false, lastSent = 0, lastPush = 0, lastHash = "", lastRace = null, sock = null, stopped = false, timer = null, reconnect = null, bytes = 0;

  async function maybePush(force) {
    if (!state.dirty && !force) return;
    if (!force && Date.now() - lastPush < pushEvery) return;
    const snap = state.snapshot();
    if (snap.race == null || snap.rows.length === 0) { state.dirty = false; return; } // never wipe results with an empty snapshot
    const hash = snap.race + JSON.stringify(snap.rows);
    state.dirty = false;
    if (hash !== lastHash) { lastChangeAt = Date.now(); ended = false; }
    if (ended) return;
    if (hash === lastHash && Date.now() - lastSent < 20000) return; // identical data is re-sent every 20 s so the 'live' flag stays fresh
    lastPush = Date.now();
    try {
      await rpc("live_update_race", { p_event: cfg.eventId, p_race_number: snap.race, p_rows: snap.rows });
      lastHash = hash; lastSent = Date.now();
      if (snap.race !== lastRace) { log(`Race ${snap.race}: sending results (${snap.rows.length} riders)`); lastRace = snap.race; }
      else log(`${new Date().toLocaleTimeString()}  race ${snap.race}  ${snap.rows.length} riders  ${snap.flag || ""}`);
    } catch (e) {
      state.dirty = true; // try again next tick
      log("Could not send results (will retry): " + (e && e.message ? e.message : e));
    }
  }

  // No lap crossings for a while = nothing is being timed: tell the app the race is no longer live (results stay provisional).
  // The feed's clock (time to go, flag) every 5 s, for the enduro display's "time remaining".
  async function sendStatus() {
    if (!state.hasClock || state.race == null || Date.now() - lastStatus < 5000) return;
    lastStatus = Date.now();
    try {
      await rpc("live_status_update", { p_event: cfg.eventId, p_race_number: state.race, p_flag: state.flag, p_time_to_go: state.timeToGo, p_race_time: state.raceTime, p_laps_to_go: state.lapsToGo });
      statusFailed = false;
    } catch (e) { if (!statusFailed) log("Could not send the race clock (run 008_enduro_display.sql?): " + (e && e.message ? e.message : e)); statusFailed = true; }
  }

  async function tickAll() {
    void sendStatus();
    const quiet = lastSent > 0 && Date.now() - lastChangeAt > quietMs;
    if (quiet && !ended) {
      try { await rpc("live_end", { p_event: cfg.eventId }); ended = true; log(`No timing activity for ${quietMs / 60000} min - race marked as no longer live.`); }
      catch (e) { ended = true; log("Could not mark race as ended: " + (e && e.message ? e.message : e)); }
      return;
    }
    await maybePush(!ended && lastSent > 0 && Date.now() - lastSent >= 20000);
  }

  function open() {
    if (stopped) return;
    log(`Connecting to feed ${cfg.feedHost}:${cfg.feedPort} ...`);
    sock = connect(cfg.feedHost, cfg.feedPort);
    sock.on("connect", () => log("Connected to feed."));
    sock.on("data", (d) => {
      bytes += d.length;
      if (rawLog) fs.appendFile(rawLog, d, () => {});
      state.push(d);
      while (state.changes.length) log("Feed started a new session: " + state.changes.shift());
    });
    sock.on("error", (e) => log("Feed error: " + e.message));
    sock.on("close", () => { if (stopped) return; log("Feed closed - reconnecting in 3 s"); reconnect = setTimeout(open, 3000); });
  }

  return {
    state,
    start() { open(); timer = setInterval(() => void tickAll(), 1000); },
    flush: () => maybePush(true),
    tick: tickAll,
    stop() { stopped = true; clearInterval(timer); clearTimeout(reconnect); if (sock) sock.destroy(); },
    get bytes() { return bytes; },
  };
}

async function main() {
  const cfgPath = path.resolve(process.argv[2] || path.join(__dirname, "config.json"));
  if (!fs.existsSync(cfgPath)) { console.error(`No config file at ${cfgPath}. Copy config.example.json to config.json and fill it in.`); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { db: { schema: "aptiming" }, auth: { persistSession: false, autoRefreshToken: true } });
  const si = await sb.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (si.error) { console.error("Sign-in failed: " + si.error.message); process.exit(1); }
  console.log("Signed in as " + cfg.email);
  if (!cfg.eventId) {
    const ev = await sb.from("events").select("id,event_name,start_date").ilike("event_name", `%${cfg.eventName || ""}%`).order("start_date", { ascending: false }).limit(5);
    if (ev.error || !ev.data?.length) { console.error("Could not find the event. Put its id in config.json as eventId."); process.exit(1); }
    cfg.eventId = ev.data[0].id; console.log(`Using event "${ev.data[0].event_name}" (${cfg.eventId})`);
    if (ev.data.length > 1) console.log("  (other matches: " + ev.data.slice(1).map((e) => e.event_name).join(", ") + ") - set eventId to be sure");
  }
  const bridge = createBridge({ cfg, rpc: async (fn, args) => { const r = await sb.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; } });
  bridge.start();
  process.on("SIGINT", () => { bridge.stop(); process.exit(0); });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { createBridge };
