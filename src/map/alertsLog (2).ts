export type AlertLogEntry = {
  id: string
  hazard_id: string
  user_type: string
  alerted_at: string
  asked_to_report: boolean
  answered_yes: boolean | null
}

const STORAGE_KEY = 'safe-walk-alerts-log-v1'

function readAlerts(): AlertLogEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value as AlertLogEntry[] : []
  } catch {
    return []
  }
}

function writeAlerts(entries: AlertLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Keep the walk mode usable if browser storage is unavailable.
  }
}

export function addAlertLog(hazardId: string, userType: string) {
  const entry: AlertLogEntry = {
    id: crypto.randomUUID(),
    hazard_id: hazardId,
    user_type: userType,
    alerted_at: new Date().toISOString(),
    asked_to_report: false,
    answered_yes: null,
  }
  writeAlerts([...readAlerts(), entry])
  return entry.id
}

export function latestAlertTime(hazardId: string) {
  return readAlerts()
    .filter((entry) => entry.hazard_id === hazardId)
    .reduce((latest, entry) => Math.max(latest, Date.parse(entry.alerted_at) || 0), 0)
}

export function updateAlertLog(id: string, updates: Partial<Pick<AlertLogEntry, 'asked_to_report' | 'answered_yes'>>) {
  writeAlerts(readAlerts().map((entry) => entry.id === id ? { ...entry, ...updates } : entry))
}

export function updateLatestAlertLog(hazardId: string, updates: Partial<Pick<AlertLogEntry, 'asked_to_report' | 'answered_yes'>>) {
  const entries = readAlerts()
  const index = entries.map((entry) => entry.hazard_id).lastIndexOf(hazardId)
  if (index < 0) return
  entries[index] = { ...entries[index], ...updates }
  writeAlerts(entries)
}
