import { createClient } from '@supabase/supabase-js'
import type { Hazard, HazardReport, HazardType, Passability } from './hazards'
import type { PhotoDraft } from '../components/ReportWizard'

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseUrl = configuredSupabaseUrl ? new URL(configuredSupabaseUrl).origin : ''
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const bucket = 'hazard-photos'

export const sharedReportsEnabled = Boolean(supabaseUrl && supabaseKey)

const supabase = sharedReportsEnabled ? createClient(supabaseUrl, supabaseKey) : null

type SharedReportRow = {
  id: string
  hazard_id: string
  reporter_id: string
  hazard_type: HazardType
  title: string
  detail: string
  place: string
  lat: number
  lng: number
  passability: { wheelchair: Passability; stroller: Passability; walking: Passability }
  severity: 1 | 2 | 3
  memo: string
  photos: string[]
  created_at: string
}

export async function readSharedHazards(): Promise<Hazard[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('hazard_reports')
    .select('id,hazard_id,reporter_id,hazard_type,title,detail,place,lat,lng,passability,severity,memo,photos,created_at')
    .order('created_at', { ascending: false })
  if (error) throw error

  const groups = new Map<string, SharedReportRow[]>()
  for (const row of (data ?? []) as SharedReportRow[]) {
    const group = groups.get(row.hazard_id) ?? []
    group.push(row)
    groups.set(row.hazard_id, group)
  }

  return [...groups.entries()].map(([hazardId, reports]) => {
    const latest = reports[0]
    const hazardReports: HazardReport[] = reports.map((report) => ({
      id: report.id,
      hazard_id: report.hazard_id,
      userId: report.reporter_id,
      photos: report.photos,
      passability: report.passability,
      severity: report.severity,
      memo: report.memo,
      status: '신고 대기',
      created_at: report.created_at,
    }))
    return {
      id: hazardId,
      type: latest.hazard_type,
      title: latest.title,
      detail: latest.detail,
      place: latest.place,
      lat: latest.lat,
      lng: latest.lng,
      status: '미신고',
      report_count: reports.length,
      last_confirmed_at: latest.created_at,
      reports: hazardReports,
      severity: latest.severity,
      memo: latest.memo,
      passability: latest.passability,
      wheelchair: latest.passability.wheelchair === '지나갈 수 있음',
      stroller: latest.passability.stroller === '지나갈 수 있음',
      walking: latest.passability.walking === '지나갈 수 있음',
      photos: [...new Set(reports.flatMap((report) => report.photos))],
    }
  })
}

export async function publishHazardReport(input: {
  reportId: string
  hazardId: string
  type: HazardType
  title: string
  detail: string
  place: string
  lat: number
  lng: number
  passability: { wheelchair: Passability; stroller: Passability; walking: Passability }
  severity: 1 | 2 | 3
  memo: string
  photos: PhotoDraft[]
}) {
  if (!supabase) return null

  let { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) throw new Error(`공유 제보 인증에 실패했어요: ${error.message}`)
    user = data.user
  }
  if (!user) throw new Error('공유 제보 사용자를 확인하지 못했어요.')

  const photoPaths = await Promise.all(input.photos.map(async (photo) => {
    const path = `${user.id}/${input.reportId}-${photo.id}.jpg`
    const blob = await (await fetch(photo.dataUrl)).blob()
    const { error } = await supabase!.storage.from(bucket).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    if (error) throw new Error(`제보 사진 업로드에 실패했어요: ${error.message}`)
    return path
  }))

  const { error } = await supabase.from('hazard_reports').insert({
    id: input.reportId,
    hazard_id: input.hazardId,
    reporter_id: user.id,
    hazard_type: input.type,
    title: input.title,
    detail: input.detail,
    place: input.place,
    lat: input.lat,
    lng: input.lng,
    passability: input.passability,
    severity: input.severity,
    memo: input.memo,
    photos: photoPaths,
  })
  if (error) throw new Error(`공유 제보 저장에 실패했어요: ${error.message}`)
  return photoPaths
}

export function getSharedPhotoUrl(path: string) {
  return supabase?.storage.from(bucket).getPublicUrl(path).data.publicUrl ?? null
}

export function subscribeToSharedReports(onChange: () => void) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('shared-hazard-reports')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hazard_reports' }, onChange)
    .subscribe()
  return () => { void supabase?.removeChannel(channel) }
}
