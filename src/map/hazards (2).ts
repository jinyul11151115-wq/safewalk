export type HazardType = '가로수 뿌리' | '보도블록 파손' | '단차·턱' | '급경사' | '좁은 보도' | '공사 장애물' | '맨홀·배수구' | '미끄러운 노면'
export type HazardStatus = '미신고' | '신고됨' | '처리완료'
export type StoredHazardStatus = HazardStatus | 'reported' | 'fixed'
export type Passability = '지나갈 수 있음' | '어려움' | '불가능'

export type HazardReport = {
  id: string
  hazard_id: string
  userId: string
  photos: string[]
  passability: { wheelchair: Passability; stroller: Passability; walking: Passability }
  severity: 1 | 2 | 3
  memo: string
  status: '신고 대기'
  created_at: string
}

export type Hazard = {
  id: string
  type: HazardType
  title: string
  detail: string
  place: string
  lat: number
  lng: number
  status: StoredHazardStatus
  report_count: number
  last_confirmed_at: string
  reports: HazardReport[]
  severity?: 1 | 2 | 3
  memo?: string
  passability?: { wheelchair: Passability; stroller: Passability; walking: Passability }
  passable_wheelchair?: boolean
  passable_stroller?: boolean
  wheelchair: boolean
  stroller: boolean
  walking: boolean
  reportCount?: number
  checkedAt?: string
  photos: string[]
  region_name?: string
  region_code?: string
  type_code?: string
  receipt_numbers?: string[]
  fixed_confirmed_at?: string
}

export function hazardStatusLabel(status: StoredHazardStatus) {
  if (status === 'reported') return '신고됨'
  if (status === 'fixed') return '처리완료'
  return status
}

export const hazardTypes: HazardType[] = ['가로수 뿌리', '보도블록 파손', '단차·턱', '급경사', '좁은 보도', '공사 장애물', '맨홀·배수구', '미끄러운 노면']
export const hazardStatuses: HazardStatus[] = ['미신고', '신고됨', '처리완료']
export const hazardTypeLabels: Record<HazardType, string> = {
  '가로수 뿌리': '뿌리',
  '보도블록 파손': '파손',
  '단차·턱': '단차',
  '급경사': '경사',
  '좁은 보도': '좁음',
  '공사 장애물': '공사',
  '맨홀·배수구': '맨홀',
  '미끄러운 노면': '미끄럼',
}
export const hazardTypeGlyphs: Record<HazardType, string> = {
  '가로수 뿌리': '⌁',
  '보도블록 파손': '▦',
  '단차·턱': '↕',
  '급경사': '↗',
  '좁은 보도': '↔',
  '공사 장애물': '⚒',
  '맨홀·배수구': '◉',
  '미끄러운 노면': '≈',
}

export const demoHazards: Hazard[] = [
  {
    id: 'demo-root', type: '가로수 뿌리', title: '가로수 뿌리로 보도 융기', detail: '보도블록이 약 7cm 솟아 있어요.', place: '대전시청 서쪽 보도',
    lat: 36.3509, lng: 127.3838, status: '미신고', report_count: 4, last_confirmed_at: '2026. 10. 20.', reports: [], wheelchair: false, stroller: false, walking: true, photos: ['example'],
  },
  {
    id: 'demo-step', type: '단차·턱', title: '횡단보도 진입 단차', detail: '경계석 높이가 약 6cm예요.', place: '둔산로 100 앞',
    lat: 36.3497, lng: 127.3853, status: '신고됨', report_count: 8, last_confirmed_at: '2026. 10. 18.', reports: [], wheelchair: false, stroller: false, walking: true, photos: ['example'],
  },
  {
    id: 'demo-slope', type: '급경사', title: '짧고 가파른 보도 경사', detail: '비가 오면 미끄러울 수 있어요.', place: '시청역 3번 출구 부근',
    lat: 36.3517, lng: 127.386, status: '처리완료', report_count: 3, last_confirmed_at: '2026. 10. 16.', reports: [], wheelchair: false, stroller: false, walking: true, photos: [],
  },
  {
    id: 'demo-narrow', type: '좁은 보도', title: '공사 펜스로 좁아진 보도', detail: '통행 가능한 폭이 약 85cm예요.', place: '시청역 5번 출구 부근',
    lat: 36.3522, lng: 127.3829, status: '미신고', report_count: 2, last_confirmed_at: '2026. 10. 21.', reports: [], wheelchair: false, stroller: true, walking: true, photos: ['example'],
  },
]

const STORAGE_KEY = 'safe-walk-hazards-v2'

export function readHazards(): Hazard[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return demoHazards
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return demoHazards
    const savedHazards = (parsed as Hazard[]).filter((hazard) => !hazard.id.startsWith('demo-')).map((hazard) => ({
      ...hazard,
      type: ({ '단차': '단차·턱', '보도 폭': '좁은 보도', '바닥 파손': '보도블록 파손' } as Record<string, HazardType>)[hazard.type] ?? hazard.type,
      report_count: hazard.report_count ?? hazard.reportCount ?? 1,
      last_confirmed_at: hazard.last_confirmed_at ?? hazard.checkedAt ?? '',
      reports: hazard.reports ?? [],
    }))
    return [...demoHazards, ...savedHazards]
  } catch {
    return demoHazards
  }
}

export function writeHazards(hazards: Hazard[]) {
  try {
    const collected = hazards.filter((hazard) => !hazard.id.startsWith('demo-'))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collected))
    return true
  } catch {
    return false
  }
}
