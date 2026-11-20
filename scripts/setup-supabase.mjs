import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const connectionString = process.env.SUPABASE_DB_URL

if (!connectionString) {
  console.error('SUPABASE_DB_URL is missing from .env')
  process.exit(1)
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 12000,
})

try {
  await client.connect()
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  await client.query(schema)
  const { rows } = await client.query(`
    select
      to_regclass('public.hazard_reports') is not null as table_ready,
      exists(select 1 from storage.buckets where id = 'hazard-photos') as photo_bucket_ready
  `)
  if (!rows[0]?.table_ready || !rows[0]?.photo_bucket_ready) {
    throw new Error('Supabase objects were not created as expected.')
  }
  console.log('Supabase connection and schema setup succeeded.')
  console.log('Shared reports table and photo bucket are ready.')
} catch (error) {
  console.error(`Supabase setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
