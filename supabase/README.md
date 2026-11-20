# Supabase shared reports

The shared report table, public read policy, photo bucket, and Realtime publication are defined in `schema.sql`. Run that file in the project's Supabase SQL Editor, or use `npm run supabase:setup` with a Supabase Personal Access Token in the local environment. The token is used only by the setup script and is never included in the browser bundle.

Anonymous sign-ins are enabled for this project. The app creates an anonymous Supabase user when a report is submitted; the demo email entered on the report screen is not sent to Supabase. The map status shows `공유 DB 연결` when the shared table is reachable. New reports are visible to all visitors. Existing local-only reports are not uploaded automatically.

The browser uses only the public publishable key. Never put a Supabase secret/service-role key in a `VITE_` variable or browser code. Row Level Security permits public reads and inserts tied to the anonymous user's ID, but no report updates or deletes. Reports and photos are public; do not include faces, license plates, email addresses, or other private information. Demo map hazards remain example data.
