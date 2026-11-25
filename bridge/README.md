# AP Timing live bridge

Reads the MyLaps scoreboard feed (TCP, port 50000) and keeps the live results in the app up to date.
Runs on a PC on the same network as the MyLaps timing PC. Public page and trailer display update by themselves.

## One-off set-up
1. Install Node.js (LTS) from nodejs.org on the bridge PC.
2. Copy this `bridge` folder to the PC, open a Command Prompt in it and run `npm install`.
3. Copy `config.example.json` to `config.json` and fill in: Supabase URL and anon key (same as the app's), your timing login email/password, the event (`eventName` or `eventId`), and the feed address (`192.168.1.241`, `50000`).
4. In Supabase, run `supabase/007_live_feed.sql` in the SQL editor.
5. In MyLaps Scoreboard Settings tick Send Race Results and Send Qualify Results.

## Each event
Create the event and upload the schedule in the app, then run `node live-bridge.js` and leave the window open.
It reconnects by itself if the feed or internet drops. Live rows are marked provisional; importing the final MyLaps
CSV for a race replaces them, and a race that already has final results is never overwritten by the feed.

## Tests
`node test-parse.js capture.bin` and `node test-bridge.js capture.bin` replay a capture made with capture-feed.js.

## If live results look wrong
Add `"saveRaw": true` to config.json and restart. Everything the feed sends is saved to `feed-raw.log` in the bridge folder.
Send that file (and a screenshot of the window) so the problem can be replayed exactly.

## Live flag
A race is marked LIVE while lap crossings keep arriving. After 5 minutes with no change the bridge marks it as no longer
live (results stay provisional until the final CSV is imported). Change with `"liveTimeoutMinutes"` in config.json.
The feed shows whichever session the timing software has open, so open the current race there.

## Enduro / Pony Express
Run `supabase/008_enduro_display.sql`, then on the Screen layout page choose Display type: Enduro. The display then shows
only the live results (Rider, Class, Total Time, Laps, Best Time) with the race clock at the bottom. The bridge sends the
timing software's clock every 5 seconds; if the timing software counts down (time to go) it shows TIME REMAINING,
otherwise it shows the elapsed RACE TIME.
