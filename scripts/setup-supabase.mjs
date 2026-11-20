import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const connectionString = process.env.SUPABASE_DB_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN
const projectUrl = process.env.VITE_SUPABASE_URL
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

if (accessToken && projectUrl) {
  try {
    const projectRef = new URL(projectUrl).hostname.split('.')[0]
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: schema }),
    })
    if (!response.ok) {
      const details = await response.text()
      throw new Error(`Supabase management API returned ${response.status}: ${details.slice(0, 500)}`)
    }
    const verify = await fetch(new URL('/rest/v1/hazard_reports?select=id&limit=1', projectUrl), {
      headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '' },
    })
    if (!verify.ok) throw new Error(`Schema request succeeded but public table check returned ${verify.status}.`)
    console.log('Supabase setup succeeded: shared report table is publicly readable.')
    process.exit(0)
  } catch (error) {
    console.error(`Supabase setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }
}

if (!connectionString) {
  console.error('Set SUPABASE_ACCESS_TOKEN and VITE_SUPABASE_URL, or SUPABASE_DB_URL.')
  process.exit(1)
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 12000,
})

try {
  await client.connect()
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
