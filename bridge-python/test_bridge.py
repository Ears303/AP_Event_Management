"""Run: python test_bridge.py   (no capture file needed - uses a synthetic feed)"""
import socket, threading, time, json, sys
from parse_feed import FeedState
from live_bridge import Bridge

F = '$F,9999,"00:00:00","10:36:16","00:25:26","Green "\r\n'
def dump(sid, race, riders, b_before):
    B = f'$B,{sid},"Race {race}"\r\n'
    H = "".join(f'$H,{i+1},"{r["no"]}",2,"00:02:{10+i}.000"\r\n' for i, r in enumerate(riders))
    G = "".join(f'$G,{i+1},"{r["no"]}",{r["laps"]},"00:0{r["laps"]}:00.{r["no"]}"\r\n' for i, r in enumerate(riders))
    SP = "".join(f'$SP,{i+1},"{r["no"]}",2,"00:02:10.000",40000\r\n' for i, r in enumerate(riders))
    A = "".join(f'$A,"{r["no"]}","{r["no"]}",1,"F{r["no"]}","L{r["no"]}","WA",{r["cls"]}\r\n' for r in riders)
    C = '$C,1,"65cc 7-U10 Yrs"\r\n$C,2,"85cc 9-U12 Yrs A Grade"\r\n'
    return (B if b_before else "") + H + G + SP + ("" if b_before else B) + A + C

passed = failed = 0
def check(n, ok, e=""):
    global passed, failed
    ok = bool(ok); passed += ok; failed += (not ok)
    print(("PASS " if ok else "FAIL ") + n + ("" if ok else " -> " + str(e)))

r1 = [dict(no=10, laps=5, cls=1), dict(no=11, laps=5, cls=1), dict(no=12, laps=4, cls=1)]
r2 = [dict(no=20, laps=3, cls=2), dict(no=21, laps=3, cls=2)]
s = FeedState()
text = dump(1, 5, r1, False) + F + F
for i in range(0, len(text), 37): s.push(text[i:i+37].encode())   # odd-sized chunks
sn = s.snapshot(); check("race 5 read", sn["race"] == 5 and len(sn["rows"]) == 3, len(sn["rows"]))
s.push(dump(1, 5, [dict(r, laps=r["laps"]+1) for r in r1], False) + F + dump(1, 5, [dict(r, laps=r["laps"]+2) for r in r1], False) + F)
sn = s.snapshot(); check("repeated dumps replace, latest laps shown", len(sn["rows"]) == 3 and sn["rows"][0]["laps"] == 7, [r["laps"] for r in sn["rows"]])
s.push(dump(2, 6, r2, False) + F)
sn = s.snapshot(); check("race change ($B after $G)", sn["race"] == 6 and len(sn["rows"]) == 2 and all(r["baseClass"] == "85cc 9-U12 Yrs" and r["grade"] == "A" for r in sn["rows"]), sn["rows"])
check("race change reported", len(s.changes) == 1 and "5->6" in s.changes[0], s.changes)
s.push(dump(3, 7, r1, True) + F)
sn = s.snapshot(); check("race change ($B first)", sn["race"] == 7 and len(sn["rows"]) == 3 and all(r["baseClass"] == "65cc 7-U10 Yrs" for r in sn["rows"]))
s.push('$G,1,"11",9,"00:09:00.000"\r\n' + F + '$G,2,"10",8,"00:09:30.000"\r\n')
sn = s.snapshot(); check("single-line updates", sn["rows"][0]["raceNo"] == "11" and sn["rows"][0]["laps"] == 9, [(r["raceNo"], r["laps"]) for r in sn["rows"]])
check("clock parsed", s.flag == "Green" and s.time_of_day == "10:36:16" and s.has_clock)

# --- bridge: replay through a real socket, with a fake clock for the quiet timeout
clock = [0.0]
now = lambda: time.time() + clock[0]
srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(5)
conns = []
def serve():
    while True:
        try: c, _ = srv.accept()
        except OSError: return
        conns.append(c)
        if len(conns) == 1: c.sendall(dump(1, 27, r1, False).encode() + F.encode()); time.sleep(0.3); c.close()
        else: c.sendall(dump(1, 27, r1, False).encode() + F.encode())
threading.Thread(target=serve, daemon=True).start()
calls, logs, fail = [], [], [True]
def rpc(fn, a):
    if fn == "live_update_race":
        if fail[0]: fail[0] = False; raise RuntimeError("network down")
    calls.append((fn, a))
b = Bridge({"eventId": "e1", "feedHost": "127.0.0.1", "feedPort": srv.getsockname()[1], "pushEverySeconds": 0.1}, rpc, log=logs.append, now=now)
b.start()
def run(sec):
    end = time.time() + sec
    while time.time() < end: b.tick(); time.sleep(0.1)
run(5)
upd = [c for c in calls if c[0] == "live_update_race"]
check("sent live_update_race for e1 race 27", upd and upd[0][1]["p_event"] == "e1" and upd[0][1]["p_race_number"] == 27, upd[:1] and {k: v for k, v in upd[0][1].items() if k != "p_rows"})
check("retried after first send failed", any("retry" in l for l in logs))
check("reconnected after feed dropped", len(conns) >= 2 and any("reconnecting" in l for l in logs), len(conns))
check("race clock sent", any(c[0] == "live_status_update" and c[1]["p_flag"] == "Green" for c in calls))
n = len(upd)
check("identical data not re-sent every tick", len(upd) <= 2, len(upd))
clock[0] += 25; run(1.5)
check("refresh after 20 s", len([c for c in calls if c[0] == "live_update_race"]) == n + 1, [c[0] for c in calls])
clock[0] += 6 * 60; run(1.5)
check("ended once after quiet minutes", len([c for c in calls if c[0] == "live_end"]) == 1, [c[0] for c in calls])
m = len(calls); clock[0] += 600; run(1.5)
check("nothing more sent while quiet (except clock)", all(c[0] == "live_status_update" for c in calls[m:]), [c[0] for c in calls[m:]])
conns[-1].sendall(b'$G,1,"12",8,"00:17:50.000"\r\n'); run(2)
check("new crossing restarts live updates", len([c for c in calls if c[0] == "live_update_race"]) == n + 2, [c[0] for c in calls])
b.stop(); srv.close()
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
