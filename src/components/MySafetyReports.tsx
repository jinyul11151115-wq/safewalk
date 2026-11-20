import { useEffect, useState, type ReactNode } from 'react'
import { Check, ClipboardList, FileClock, ShieldCheck } from 'lucide-react'
import { Button } from './ui/button'
import { type Hazard } from '../map/hazards'
import type { SafetyReport } from '../map/safetyReports'

type PersonalPending = { id: string; hazardId?: string; hazard_id?: string; hazardTitle: string; status: string; created_at: string }
type Props = {
  active: boolean
  hazards: Hazard[]
  safetyReports: SafetyReport[]
  onOpenSafetyReport: (hazard: Hazard, focusReceipt: boolean) => void
  onConfirmFixed: (hazard: Hazard) => void
}

const PENDING_KEY = 'safe-walk-demo-my-reports-v1'
type Status = '신고 대기' | '신고됨' | '처리완료'
type Filter = Status | '전체'
type ReportItem = {
  id: string
  status: Status
  createdAt: string
  hazard?: Hazard
  safetyReport?: SafetyReport
  personalPending?: PersonalPending
}

function readPersonalPending(): PersonalPending[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(value) ? value as PersonalPending[] : []
  } catch {
    return []
  }
}

function isFixed(hazard: Hazard) {
  return hazard.status === 'fixed' || hazard.status === '처리완료'
}

function isReported(hazard: Hazard) {
  return hazard.status === 'reported' || hazard.status === '신고됨'
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '날짜 정보 없음' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date)
}

export function MySafetyReports({ active, hazards, safetyReports, onOpenSafetyReport, onConfirmFixed }: Props) {
  const [filter, setFilter] = useState<Filter>('전체')
  const [personalPending, setPersonalPending] = useState<PersonalPending[]>(readPersonalPending)

  useEffect(() => {
    if (active) setPersonalPending(readPersonalPending())
  }, [active, safetyReports])

  const ownHazards = hazards.filter((hazard) => !hazard.id.startsWith('demo-'))
  const safetyReportsForOpenHazards = safetyReports.filter((report) => !hazards.some((hazard) => hazard.id === report.hazard_id && isFixed(hazard)))
  const personalWithSafetyRecord = new Set(safetyReportsForOpenHazards.map((report) => report.hazard_id))
  const localPending = personalPending.filter((report) => {
    const hazardId = report.hazardId ?? report.hazard_id
    return !hazardId || (!personalWithSafetyRecord.has(hazardId) && !ownHazards.some((hazard) => hazard.id === hazardId && isFixed(hazard)))
  })
  const pendingSafetyReports = safetyReportsForOpenHazards.filter((report) => !report.receipt_number)
  const reportedSafetyReports = safetyReportsForOpenHazards.filter((report) => Boolean(report.receipt_number))
  const reportedSafetyHazards = ownHazards.filter((hazard) => isReported(hazard) && !personalWithSafetyRecord.has(hazard.id))
  const fixedHazards = ownHazards.filter(isFixed)
  const pendingCount = pendingSafetyReports.length + localPending.length
  const reportedCount = reportedSafetyReports.length + reportedSafetyHazards.length
  const fixedCount = fixedHazards.length

  const allItems: ReportItem[] = [
    ...pendingSafetyReports.map((report): ReportItem => ({
      id: `pending-${report.id}`,
      status: '신고 대기',
      createdAt: report.created_at,
      hazard: hazards.find((item) => item.id === report.hazard_id),
      safetyReport: report,
    })),
    ...localPending.map((report): ReportItem => ({
      id: `local-${report.id}`,
      status: '신고 대기',
      createdAt: report.created_at,
      hazard: hazards.find((item) => item.id === (report.hazardId ?? report.hazard_id)),
      personalPending: report,
    })),
    ...reportedSafetyReports.map((report): ReportItem => ({
      id: `reported-${report.id}`,
      status: '신고됨',
      createdAt: report.reported_at ?? report.created_at,
      hazard: hazards.find((item) => item.id === report.hazard_id),
      safetyReport: report,
    })),
    ...reportedSafetyHazards.map((hazard): ReportItem => ({
      id: `reported-${hazard.id}`,
      status: '신고됨',
      createdAt: hazard.last_confirmed_at,
      hazard,
    })),
    ...fixedHazards.map((hazard): ReportItem => ({
      id: `fixed-${hazard.id}`,
      status: '처리완료',
      createdAt: hazard.fixed_confirmed_at ?? hazard.last_confirmed_at,
      hazard,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const visibleItems = filter === '전체' ? allItems : allItems.filter((item) => item.status === filter)

  function openHazard(id: string | undefined, focusReceipt: boolean) {
    if (!id) return
    const hazard = hazards.find((item) => item.id === id)
    if (hazard) onOpenSafetyReport(hazard, focusReceipt)
  }

  function renderItem(item: ReportItem) {
    const { hazard, safetyReport, personalPending: personal } = item
    const title = hazard?.title ?? safetyReport?.hazard_title ?? personal?.hazardTitle ?? '보행 위험 신고'

    if (item.status === '신고 대기') {
      const hazardId = hazard?.id ?? personal?.hazardId ?? personal?.hazard_id
      return <article key={item.id} className="safety-list-card"><span className="pending-badge">{safetyReport ? '접수번호 입력 대기' : '신고 대기'}</span><strong>{title}</strong><span>{safetyReport ? `${safetyReport.hazard_type ?? hazard?.type ?? '위험 지점'} · ${safetyReport.hazard_detail || hazard?.detail || '보행 위험 제보'} · 사진 ${safetyReport.photo_count ?? hazard?.photos.length ?? 0}장` : formatDate(item.createdAt)}</span><small>{hazard?.place ?? '등록 위치'} · {formatDate(item.createdAt)}</small><div><Button variant="secondary" aria-label={`${title} 신고 화면 다시 열기`} disabled={!hazardId} onClick={() => openHazard(hazardId, false)}>신고 화면 다시 열기</Button>{hazardId && <Button variant="primary" aria-label={`${title} 접수번호 입력`} onClick={() => openHazard(hazardId, true)}>접수번호 입력</Button>}</div></article>
    }

    if (item.status === '신고됨') {
      const receipt = safetyReport?.receipt_number ?? hazard?.receipt_numbers?.[hazard.receipt_numbers.length - 1] ?? '확인 필요'
      return <article key={item.id} className="safety-list-card"><span className="reported-badge"><Check size={13} />신고됨</span><strong>{title}</strong><span>{safetyReport ? `${safetyReport.hazard_type ?? hazard?.type ?? '위험 지점'} · ${safetyReport.hazard_detail || hazard?.detail || '보행 위험 제보'}` : `${hazard?.place ?? '등록 위치'} · 접수번호 ${receipt}`}</span>{safetyReport && <small>접수번호 {receipt} · {formatDate(item.createdAt)}</small>}<div><Button variant="secondary" aria-label={`${title} 신고 화면 다시 열기`} disabled={!hazard} onClick={() => hazard && onOpenSafetyReport(hazard, false)}>신고 화면 다시 열기</Button>{hazard && <Button variant="primary" aria-label={`${title} 처리완료 확인`} onClick={() => onConfirmFixed(hazard)}>처리완료 확인</Button>}</div></article>
    }

    return <article key={item.id} className="safety-list-card"><span className="fixed-badge"><Check size={13} />처리완료</span><strong>{title}</strong><span>{hazard?.place ?? '등록 위치'} · 확인 사진 {hazard ? Math.max(0, hazard.photos.length - 1) : 0}장</span><small>{formatDate(item.createdAt)}</small></article>
  }

  const emptyContent = filter === '전체'
    ? { icon: <ClipboardList size={26} />, title: '아직 신고 내역이 없어요.', detail: '위험 지점을 제보하면 여기에 모아 보여드려요.' }
    : filter === '신고 대기'
      ? { icon: <FileClock size={26} />, title: '접수번호 대기 중인 신고가 없어요.', detail: '안전신문고에서 받은 번호를 아직 입력하지 않은 신고가 여기에 보여요.' }
      : filter === '신고됨'
        ? { icon: <ShieldCheck size={26} />, title: '등록된 접수번호가 없어요.', detail: '접수번호를 등록하면 이곳에서 다시 확인할 수 있어요.' }
        : { icon: <Check size={26} />, title: '처리완료로 확인된 지점이 없어요.', detail: '보수된 위험 지점을 확인하면 여기에 모아 보여드려요.' }

  return <section className="my-safety-reports" aria-labelledby="my-safety-reports-title">
    <div className="my-safety-heading"><div><p className="eyebrow">내 기록</p><h1 id="my-safety-reports-title" tabIndex={-1}>내 신고 목록</h1></div><ClipboardList size={25} /></div>
    <div className="safety-report-filters" role="group" aria-label="신고 상태별 목록">
      {(['신고 대기', '신고됨', '처리완료'] as const).map((status) => <button key={status} type="button" aria-label={`${status} 신고만 보기`} aria-pressed={filter === status} className={filter === status ? 'active' : ''} onClick={() => setFilter((current) => current === status ? '전체' : status)}>{status}<span>{status === '신고 대기' ? pendingCount : status === '신고됨' ? reportedCount : fixedCount}</span></button>)}
    </div>
    <div className="safety-report-list" aria-live="polite">
      {visibleItems.length > 0 ? visibleItems.map(renderItem) : <EmptyReports {...emptyContent} />}
    </div>
  </section>
}

function EmptyReports({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="no-reports">{icon}<p>{title}</p><span>{detail}</span></div>
}
