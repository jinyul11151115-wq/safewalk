export type SafetyReport = {
  id: string
  hazard_id: string
  hazard_title: string
  hazard_type: string
  hazard_detail: string
  photo_count: number
  receipt_number: string | null
  created_at: string
  reported_at: string | null
}

const STORAGE_KEY = 'safe-walk-safety-reports-v1'

export function readSafetyReports(): SafetyReport[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? (value as Partial<SafetyReport>[]).map((report) => ({
      id: report.id ?? crypto.randomUUID(),
      hazard_id: report.hazard_id ?? '',
      hazard_title: report.hazard_title ?? '보행 위험 신고',
      hazard_type: report.hazard_type ?? '위험 지점',
      hazard_detail: report.hazard_detail ?? '',
      photo_count: report.photo_count ?? 0,
      receipt_number: report.receipt_number ?? null,
      created_at: report.created_at ?? new Date().toISOString(),
      reported_at: report.reported_at ?? null,
    })) : []
  } catch {
    return []
  }
}

export function writeSafetyReports(reports: SafetyReport[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
    return true
  } catch {
    return false
  }
}

export function getOrCreatePendingSafetyReport(hazard: { id: string; title: string; type: string; detail: string; photos: string[] }) {
  const reports = readSafetyReports()
  const metadata = { hazard_title: hazard.title, hazard_type: hazard.type, hazard_detail: hazard.detail, photo_count: hazard.photos.filter((photo) => photo !== 'example').length }
  const existing = reports.find((report) => report.hazard_id === hazard.id && !report.receipt_number)
  if (existing) {
    const updated = { ...existing, ...metadata }
    writeSafetyReports(reports.map((report) => report.id === existing.id ? updated : report))
    return updated
  }
  const pending: SafetyReport = {
    id: crypto.randomUUID(),
    hazard_id: hazard.id,
    ...metadata,
    receipt_number: null,
    created_at: new Date().toISOString(),
    reported_at: null,
  }
  writeSafetyReports([pending, ...reports])
  return pending
}
