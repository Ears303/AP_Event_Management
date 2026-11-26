# AP Timing live bridge (Python)

Same job as the Node bridge, but needs only Python - no `npm install`, no extra packages.
Reads the MyLaps scoreboard feed (TCP, port 50000) and keeps the live results in the app up to date.
Runs on a PC on the same network as the MyLaps timing PC.

## One-off set-up
1. Install Python 3 from python.org (tick **Add python.exe to PATH**). Check: `py --version`.
2. Unzip this folder anywhere (e.g. `C:\bridge`).
3. In Supabase, run `supabase/007_live_feed.sql` (and `008_enduro_display.sql` for enduro) in the SQL editor.
4. In MyLaps Scoreboard Settings tick Send Race Results and Send Qualify Results.

## Each event
Double-click **start-bridge.bat** and leave the window open. At start-up it shows the event and gives you 6 seconds to press C to pick a different one. The first time it asks for the Supabase URL and anon key,
your timing login, the event name and the feed address, and saves them to `config.json`. After that it just starts.
It reconnects by itself if the feed or internet drops. If it stops, the window offers R to restart.

## Settings (config.json)
`supabaseUrl`, `supabaseAnonKey`, `email`, `password`, `eventName` or `eventId`, `feedHost` (192.168.1.241), `feedPort` (50000).
Optional: `pushEverySeconds` (2), `liveTimeoutMinutes` (5 - quiet minutes before a race stops being LIVE),
`saveRaw: true` (saves everything the feed sends to `feed-raw.log` so a problem can be replayed).
To change event or login, edit config.json, or delete it to run the questions again.

## Tests
`python test_bridge.py` replays a synthetic feed through the parser and a real socket.
