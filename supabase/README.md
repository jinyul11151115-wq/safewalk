# Supabase setup

1. Open the Supabase SQL Editor for this project and run `schema.sql`.
2. In Authentication settings, enable anonymous sign-ins. The app creates an anonymous Supabase user when the first report is submitted; no email is sent to Supabase.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the app environment, then restart the Vite dev server.
4. Reload the app. The map status should change to `공유 DB 연결` after the table can be read.

The public publishable key is intended for browser use. Do not put a Supabase secret/service-role key in a `VITE_` variable or browser code. Row Level Security allows public reads, authenticated inserts tied to the anonymous user's ID, and no report updates or deletes. Hazard reports and photos are public and should not include a person's face, license plate, email, or other private information.

The existing demo hazards remain example data. Only reports submitted after Supabase is configured are shared. Legacy local-only records are not automatically uploaded.
