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
