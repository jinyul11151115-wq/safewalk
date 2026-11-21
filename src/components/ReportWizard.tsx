import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleUserRound, FileClock, ImagePlus, Info, MapPin, ShieldCheck, Upload, X } from 'lucide-react'
import { Button } from './ui/button'
import { useMapContext, type Coordinates } from '../map/MapContext'
import { hazardTypeGlyphs, hazardTypes, type Hazard, type HazardReport, type HazardType, type Passability } from '../map/hazards'
import { resolveRegion } from '../map/region'
import { saveDemoPhotos } from '../map/demoPhotoStorage'
import { publishHazardReport, sharedReportsEnabled } from '../map/sharedReports'

type PhotoSlot = 'wide' | 'close'
export type PhotoDraft = { id: string; name: string; dataUrl: string; width: number; height: number }
type PersonalReport = HazardReport & { hazardTitle: string; userEmail: string }
type CompletedReport = { report: PersonalReport; merged: boolean; shared: boolean }

const REPORTS_KEY = 'safe-walk-demo-my-reports-v1'
const steps = ['위치', '사진', '유형', '통행', '심각도', '확인']
const passabilityChoices: Passability[] = ['지나갈 수 있음', '어려움', '불가능']

function loadReports(): PersonalReport[] {
  try {
    const records: unknown = JSON.parse(localStorage.getItem(REPORTS_KEY) ?? '[]')
    return Array.isArray(records) ? records as PersonalReport[] : []
  } catch {
    return []
  }
}

function distanceMeters(a: Coordinates, b: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDelta = radians(b.lat - a.lat)
  const lngDelta = radians(b.lng - a.lng)
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export async function resizePhoto(file: File): Promise<PhotoDraft> {
  let source: CanvasImageSource
  let sourceWidth: number
  let sourceHeight: number
  let closeSource = () => {}
  try {
    const bitmap = await createImageBitmap(file)
    source = bitmap
    sourceWidth = bitmap.width
    sourceHeight = bitmap.height
    closeSource = () => bitmap.close()
  } catch {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.src = url
    try {
      await image.decode()
      source = image
      sourceWidth = image.naturalWidth
      sourceHeight = image.naturalHeight
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight))
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('사진을 줄이지 못했어요. 다른 사진을 골라주세요.')
  context.drawImage(source, 0, 0, width, height)
  closeSource()
  return {
    id: crypto.randomUUID(),
    name: file.name,
    dataUrl: canvas.toDataURL('image/jpeg', 0.84),
    width,
    height,
  }
}

type Props = {
  active: boolean
  hazards: Hazard[]
  onHazardsChange: (hazards: Hazard[]) => void
  reportLocation: Coordinates | null
  onReportLocationChange: (location: Coordinates) => void
  positionAdjusted: boolean
  onStepChange: (step: number) => void
  onOpenLocationMap?: () => void
  onLocationMapDone?: () => void
  onAuthChange: (loggedIn: boolean) => void
  onClose: () => void
}

export function ReportWizard({ active, hazards, onHazardsChange, reportLocation, onReportLocationChange, positionAdjusted, onStepChange, onOpenLocationMap, onLocationMapDone, onAuthChange, onClose }: Props) {
  const { currentLocation, moveToMyLocation } = useMapContext()
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem('safe-walk-demo-user') ?? '')
  const [emailInput, setEmailInput] = useState('')
  const [step, setStep] = useState(1)
  const [view, setView] = useState<'form' | 'complete' | 'list'>('form')
  const [photos, setPhotos] = useState<Record<PhotoSlot, PhotoDraft | null>>({ wide: null, close: null })
  const [selectedType, setSelectedType] = useState<HazardType | null>(null)
  const [passability, setPassability] = useState<{ wheelchair: Passability | null; stroller: Passability | null; walking: Passability | null }>({ wheelchair: null, stroller: null, walking: null })
  const [severity, setSeverity] = useState<1 | 2 | 3 | null>(null)
  const [memo, setMemo] = useState('')
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState<PhotoSlot | null>(null)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState<CompletedReport | null>(null)
  const [sharingWarning, setSharingWarning] = useState('')
  const [reports, setReports] = useState<PersonalReport[]>(loadReports)
  const wizardStepRef = useRef<HTMLDivElement>(null)
  const myReports = reports.filter((report) => report.userEmail === userEmail || report.userEmail === '기기 사용자')

  useEffect(() => {
    if (!positionAdjusted && currentLocation) {
      onReportLocationChange(currentLocation)
      setAccuracy(currentLocation.accuracy ?? null)
    }
  }, [currentLocation, onReportLocationChange, positionAdjusted])

  useEffect(() => onStepChange(view === 'form' ? step : 0), [onStepChange, step, view])

  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      if (!userEmail) document.querySelector<HTMLElement>('.report-login h1')?.focus({ preventScroll: true })
      else if (view === 'list') document.querySelector<HTMLElement>('.my-reports-heading h2')?.focus({ preventScroll: true })
      else if (view === 'complete') document.querySelector<HTMLElement>('.report-complete h2')?.focus({ preventScroll: true })
      else wizardStepRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, step, userEmail, view])

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = emailInput.trim()
    if (!email) return
    localStorage.setItem('safe-walk-demo-user', email)
    setUserEmail(email)
    onAuthChange(true)
  }

  async function refreshGps() {
    setError('')
    onOpenLocationMap?.()
    const position = await moveToMyLocation()
    if (!position) {
      setError('현재 위치를 확인하지 못했어요. 지도를 움직여 핀을 맞춰주세요.')
      return
    }
    onReportLocationChange(position)
    setAccuracy(position.accuracy ?? null)
    onLocationMapDone?.()
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>, slot: PhotoSlot) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('사진 파일을 선택해 주세요.')
      return
    }
    setError('')
    setPhotoBusy(slot)
    try {
      const resized = await resizePhoto(file)
      setPhotos((current) => ({ ...current, [slot]: resized }))
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : '사진을 불러오지 못했어요.')
    } finally {
      setPhotoBusy(null)
    }
  }

  function validateStep() {
    if (step === 1 && !reportLocation) return '제보 위치를 먼저 확인해 주세요.'
    if (step === 2 && (!photos.wide || !photos.close)) return '두 사진을 모두 추가해 주세요.'
    if (step === 3 && !selectedType) return '위험 유형을 하나 골라주세요.'
    if (step === 4 && (!passability.wheelchair || !passability.stroller || !passability.walking)) return '세 이동 방법의 통행 여부를 모두 골라주세요.'
    if (step === 5 && !severity) return '위험 정도를 하나 골라주세요.'
    return ''
  }

  function nextStep() {
    const message = validateStep()
    if (message) {
      setError(message)
      return
    }
    setError('')
    setStep((current) => Math.min(6, current + 1))
  }

  async function submitReport() {
    if (!reportLocation || !selectedType || !severity || !photos.wide || !photos.close || !passability.wheelchair || !passability.stroller || !passability.walking) return
    setBusy(true)
    setError('')
    const now = new Date()
    const dateLabel = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(now)
    const reportId = crypto.randomUUID()
    const match = hazards.find((hazard) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(hazard.id) && hazard.type === selectedType && distanceMeters(reportLocation, hazard) <= 15)
    const reportHazardId = match?.id ?? crypto.randomUUID()
    try {
      const region = match ? null : await resolveRegion(reportLocation).catch(() => ({ region_name: '위치 주소 확인 필요', region_code: 'unknown' }))
      await saveDemoPhotos([photos.wide, photos.close])
      const report: PersonalReport = {
        id: reportId,
        hazard_id: reportHazardId,
        userId: userEmail,
        photos: [photos.wide.id, photos.close.id],
        passability: { wheelchair: passability.wheelchair, stroller: passability.stroller, walking: passability.walking },
        severity,
        memo: memo.trim(),
        status: '신고 대기',
        created_at: now.toISOString(),
        hazardTitle: match?.title ?? `${selectedType} 위험 지점`,
        userEmail,
      }
      let sharedPhotoPaths: string[] | null = null
      let shared = false
      try {
        sharedPhotoPaths = await publishHazardReport({
          reportId,
          hazardId: reportHazardId,
          type: selectedType,
          title: report.hazardTitle,
          detail: memo.trim() || `${selectedType}으로 통행이 불편해요.`,
          place: region?.region_name ?? match?.place ?? '위치 확인 필요',
          lat: reportLocation.lat,
          lng: reportLocation.lng,
          passability: report.passability,
          severity,
          memo: memo.trim(),
          photos: [photos.wide, photos.close],
        })
        shared = Boolean(sharedPhotoPaths)
      } catch (shareError) {
        const reason = shareError instanceof Error ? shareError.message : '서버 연결에 실패했어요.'
        setSharingWarning(`서버 공유에 실패해 이 기기에만 저장했어요. 다른 사람에게는 아직 보이지 않습니다. (${reason})`)
      }
      let updated: Hazard[]
      if (match) {
        updated = hazards.map((hazard) => hazard.id !== match.id ? hazard : {
          ...hazard,
          report_count: hazard.report_count + 1,
          last_confirmed_at: now.toISOString(),
          reports: [...hazard.reports, report],
          photos: [...hazard.photos, ...(sharedPhotoPaths ?? report.photos)],
          passability: report.passability,
          severity,
          memo: memo.trim(),
          wheelchair: passability.wheelchair === '지나갈 수 있음',
          stroller: passability.stroller === '지나갈 수 있음',
          walking: passability.walking === '지나갈 수 있음',
        })
      } else if (region) {
        const hazard: Hazard = {
          id: reportHazardId,
          type: selectedType,
          title: report.hazardTitle,
          detail: memo.trim() || `${selectedType}으로 통행이 불편해요.`,
          place: region.region_name,
          lat: reportLocation.lat,
          lng: reportLocation.lng,
          region_name: region.region_name,
          region_code: region.region_code,
          status: '미신고',
          report_count: 1,
          last_confirmed_at: now.toISOString(),
          reports: [report],
          severity,
          memo: memo.trim(),
        passability: report.passability,
          wheelchair: passability.wheelchair === '지나갈 수 있음',
          stroller: passability.stroller === '지나갈 수 있음',
          walking: passability.walking === '지나갈 수 있음',
          reportCount: 1,
          checkedAt: dateLabel,
          photos: sharedPhotoPaths ?? report.photos,
        }
        updated = [hazard, ...hazards]
      } else {
        throw new Error('위험 지점을 저장하지 못했어요.')
      }
      onHazardsChange(updated)
      setCompleted({ report, merged: Boolean(match), shared })
      setView('complete')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '제보를 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  function saveForLater() {
    if (!completed) return
    const next = [completed.report, ...reports]
    localStorage.setItem(REPORTS_KEY, JSON.stringify(next))
    setReports(next)
    setView('list')
  }

  function openSafetyReport() {
    if (!completed) return
    window.open('https://www.safetyreport.go.kr/', '_blank', 'noopener,noreferrer')
  }

  function resetWizard() {
    setStep(1)
    setView('form')
    setPhotos({ wide: null, close: null })
    setSelectedType(null)
    setPassability({ wheelchair: null, stroller: null, walking: null })
    setSeverity(null)
    setMemo('')
    setCompleted(null)
    setError('')
  }

  if (!userEmail) return (
    <section className="report-login" aria-labelledby="report-login-title">
      <div className="report-login-icon"><CircleUserRound size={27} /></div>
      <p className="eyebrow">제보하기</p>
      <h1 id="report-login-title" tabIndex={-1}>로그인 후<br />안전 정보를 나눠요.</h1>
      <p className="report-login-copy">이 화면의 이메일 입력은 체험용 이름 설정이며 실제 계정 인증은 아닙니다.</p>
      <div className="demo-auth-notice"><InfoIcon /> 입력한 이메일은 이 기기의 내 제보 목록 구분에만 사용돼요. {sharedReportsEnabled ? '제보 위치·내용·사진은 공유 서버에 공개돼요.' : '공유 DB 연결 전에는 제보가 이 기기에만 저장돼요.'}</div>
      <details className="privacy-policy">
        <summary>개인정보처리방침</summary>
        <div className="privacy-policy-content">
          <h2>개인정보 처리 안내</h2>
          <p>안심보행은 보행 위험 정보를 등록하고 다른 이용자와 공유하기 위해 아래 정보를 처리합니다.</p>
          <h3>처리하는 정보와 목적</h3>
          <ul>
            <li>제보할 때 선택한 위치, 위험 유형, 통행 가능 여부, 심각도, 메모, 사진: 위험 지점을 지도에 표시하고 이용자에게 공유합니다.</li>
            <li>제보 저장 시 생성되는 익명 사용자 식별자와 등록 시각: 제보 기록을 저장하고 구분하는 데 사용합니다.</li>
            <li>이 화면에 입력한 이메일: 현재 체험용으로 이 브라우저의 내 제보 목록을 구분할 때만 사용합니다. 이메일 주소는 Supabase로 전송하지 않으며 실제 로그인 인증에도 사용하지 않습니다.</li>
          </ul>
          <h3>공개 범위와 위치 정보</h3>
          <p>Supabase 연결이 정상인 경우 제보 위치·내용·사진은 다른 이용자도 볼 수 있도록 공개 데이터베이스와 사진 저장소에 저장됩니다. 공개 제보에는 얼굴, 차량 번호판, 연락처 등 개인정보를 포함하지 마세요. 보행 중 현재 위치와 이동 이력은 기기에서 처리하며 서버에 전송하지 않습니다. 단, 사용자가 제보를 등록한 위치는 해당 제보와 함께 공개됩니다.</p>
          <h3>보관 기간과 삭제 요청</h3>
          <p>체험 이메일과 이 기기의 내 제보 기록은 브라우저 저장공간에 보관되며, 브라우저 데이터 삭제 시 함께 지워질 수 있습니다. 서버에 제출된 제보와 사진은 서비스 운영자가 삭제할 때까지 공개 저장소에 보관됩니다. 현재 앱에는 이용자가 직접 서버 제보를 삭제하는 기능이 없습니다.</p>
          <h3>문의</h3>
          <p>개인정보 관련 문의는 서비스 운영자에게 요청해 주세요. 현재 이 앱에는 별도 문의처가 등록되어 있지 않습니다.</p>
          <p className="privacy-policy-updated">시행일: 2026년 11월 21일</p>
        </div>
      </details>
      <form className="demo-login-form" onSubmit={signIn}>
        <label htmlFor="demo-email">체험용 이메일</label>
        <input id="demo-email" type="email" required autoComplete="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} placeholder="name@example.com" />
        <Button type="submit" variant="primary" className="wide-button" aria-label="체험 계정으로 로그인">체험 계정으로 로그인 <ArrowRight size={18} /></Button>
      </form>
      <button type="button" className="wizard-back-link" onClick={onClose} aria-label="지도 탭으로 돌아가기"><ArrowLeft size={16} />지도 보기</button>
    </section>
  )

  return (
    <section className="report-wizard" aria-labelledby="wizard-title">
      <div className="wizard-topline">
        <div><p className="eyebrow">제보하기</p><h1 id="wizard-title" tabIndex={-1}>보행 위험 제보</h1></div>
        <button type="button" className="demo-account" aria-label="체험 계정 로그아웃" onClick={() => { localStorage.removeItem('safe-walk-demo-user'); setUserEmail(''); setEmailInput(''); onAuthChange(false) }}><CircleUserRound size={16} />체험 계정 <X size={14} /></button>
      </div>
      <div className="report-subtabs" role="group" aria-label="제보 메뉴">
        <button type="button" aria-label="새 제보 화면" aria-pressed={view !== 'list'} className={view !== 'list' ? 'active' : ''} onClick={() => { if (view === 'list') resetWizard(); setView('form') }}>새 제보</button>
        <button type="button" aria-label="내 제보 목록 보기" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>내 제보 <span>{myReports.length}</span></button>
      </div>

      {view === 'list' && <div className="my-reports-view"><div className="my-reports-heading"><div><p className="eyebrow">내 기록</p><h2 tabIndex={-1}>신고 대기 목록</h2></div><FileClock size={23} /></div>{myReports.length ? myReports.map((report) => <article key={report.id} className="my-report-card"><span className="pending-badge">신고 대기</span><strong>{report.hazardTitle}</strong><span>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(report.created_at))} · 사진 {report.photos.length}장</span><small>{report.userEmail}</small></article>) : <div className="no-reports"><FileClock size={26} /><p>아직 저장된 제보가 없어요.</p><span>신고를 나중에 하기로 하면 여기에 남아요.</span></div>}<Button variant="secondary" className="wide-button" aria-label="새 위험 제보 시작" onClick={() => { resetWizard(); setView('form') }}>새 제보 시작</Button></div>}

      {view === 'form' && <>
        <div className="wizard-progress" aria-label={`총 6단계 중 ${step}단계`}><div className="wizard-progress-top"><span>단계 {step} / 6</span><strong>{steps[step - 1]}</strong></div><div className="wizard-progress-track"><span style={{ width: `${step / 6 * 100}%` }} /></div></div>
        <div className="wizard-step" key={step} ref={wizardStepRef} role="region" aria-label={`${steps[step - 1]} 단계 입력`} tabIndex={-1}>
          {step === 1 && <section className="wizard-content" aria-labelledby="step-location-title"><p className="eyebrow">1단계 · 위치</p><h2 id="step-location-title" tabIndex={-1}>위험 지점은 어디인가요?</h2><p className="step-description">지도에서 핀을 끌어 정확한 위치로 옮겨주세요.</p><div className="accuracy-card"><span className="accuracy-pulse"><MapPin size={18} /></span><div><strong>{positionAdjusted ? '핀으로 위치를 보정했어요' : accuracy !== null ? `위치 정확도 약 ${Math.max(1, Math.round(accuracy))}미터` : '대전시청 부근을 표시했어요'}</strong><span>{reportLocation ? `${reportLocation.lat.toFixed(5)}, ${reportLocation.lng.toFixed(5)}` : '현재 위치 권한을 확인해 주세요'}</span></div><button type="button" aria-label="현재 GPS 위치 다시 찾기" onClick={refreshGps}><CrosshairIcon /></button></div><Button variant="secondary" className="wide-button gps-button" aria-label="현재 GPS 위치 찾기" onClick={refreshGps}><MapPin size={18} />현재 GPS 위치 찾기</Button><p className="map-drag-hint">핀을 누른 채 움직여 위치를 보정할 수 있어요.</p></section>}

          {step === 2 && <section className="wizard-content" aria-labelledby="step-photo-title"><p className="eyebrow">2단계 · 사진</p><h2 id="step-photo-title" tabIndex={-1}>사진 두 장을 올려주세요.</h2><p className="step-description">멀리서 한 장, 가까이서 한 장이 필요해요.</p><div className="photo-slots"><PhotoPicker title="멀리서 구간 전체" description="위험 지점과 주변이 함께 보이게" photo={photos.wide} busy={photoBusy === 'wide'} onChange={(event) => handlePhoto(event, 'wide')} /><PhotoPicker title="가까이서 위험 부위" description="단차나 파손 부위를 자세히" photo={photos.close} busy={photoBusy === 'close'} onChange={(event) => handlePhoto(event, 'close')} /></div><div className="photo-safety-note"><ShieldCheck size={20} /><span>사람 얼굴이나 차량 번호판이 나오지 않게 찍어 주세요. 차도에 나가서 찍지 마세요.</span></div><p className="resize-note">사진은 저장 전에 긴 쪽을 1600px 이하로 줄여요. 현재는 브라우저에 임시 저장됩니다.</p></section>}

          {step === 3 && <section className="wizard-content" aria-labelledby="step-type-title"><p className="eyebrow">3단계 · 위험 유형</p><h2 id="step-type-title" tabIndex={-1}>어떤 위험인가요?</h2><p className="step-description">가장 가까운 유형 하나를 골라주세요.</p><div className="type-choice-grid" role="group" aria-label="위험 유형 하나 선택">{hazardTypes.map((type) => <button type="button" key={type} className={`type-choice ${selectedType === type ? 'selected' : ''}`} aria-pressed={selectedType === type} aria-label={`${type} 선택`} onClick={() => setSelectedType(type)}><span className="type-choice-glyph" aria-hidden="true">{hazardTypeGlyphs[type]}</span><span>{type}</span>{selectedType === type && <Check size={17} aria-hidden="true" />}</button>)}</div></section>}

          {step === 4 && <section className="wizard-content" aria-labelledby="step-access-title"><p className="eyebrow">4단계 · 통행 가능 여부</p><h2 id="step-access-title" tabIndex={-1}>누가 지나가기 어려운가요?</h2><p className="step-description">각 이동 방법마다 하나씩 골라주세요.</p><div className="passability-groups">{([{ key: 'wheelchair', label: '휠체어' }, { key: 'stroller', label: '유모차' }, { key: 'walking', label: '걸어서' }] as const).map(({ key, label }) => <fieldset className="passability-group" key={key}><legend>{label}</legend><div>{passabilityChoices.map((choice) => <button type="button" key={choice} className={`passability-choice ${passability[key] === choice ? 'selected' : ''}`} aria-pressed={passability[key] === choice} aria-label={`${label}: ${choice}`} onClick={() => setPassability((current) => ({ ...current, [key]: choice }))}>{choice}</button>)}</div></fieldset>)}</div></section>}

          {step === 5 && <section className="wizard-content" aria-labelledby="step-severity-title"><p className="eyebrow">5단계 · 심각도와 메모</p><h2 id="step-severity-title" tabIndex={-1}>얼마나 위험한가요?</h2><p className="step-description">현장에서 느낀 정도를 골라주세요. 메모는 선택이에요.</p><div className="severity-choices" role="group" aria-label="위험 심각도 선택">{([1, 2, 3] as const).map((level) => <button type="button" key={level} className={`severity-choice severity-${level} ${severity === level ? 'selected' : ''}`} aria-pressed={severity === level} aria-label={`심각도 ${level}단계`} onClick={() => setSeverity(level)}><span>{level}</span><strong>{['가벼움', '주의 필요', '매우 위험'][level - 1]}</strong><small>{['조심하면 지나갈 수 있어요', '이동에 불편이 커요', '통행이 거의 어려워요'][level - 1]}</small></button>)}</div><label className="memo-label" htmlFor="report-memo">추가 메모 <span>선택</span></label><textarea id="report-memo" value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} maxLength={300} placeholder="위험한 상황을 짧게 적어주세요" /></section>}

          {step === 6 && <section className="wizard-content" aria-labelledby="step-review-title"><p className="eyebrow">6단계 · 마지막 확인</p><h2 id="step-review-title" tabIndex={-1}>제보 내용을 확인해 주세요.</h2><div className="review-card"><div><span>위치</span><strong>{reportLocation ? `${reportLocation.lat.toFixed(5)}, ${reportLocation.lng.toFixed(5)}` : '대전시청 부근'}</strong></div><div><span>사진</span><strong>구간 전체 1장 · 위험 부위 1장</strong></div><div><span>위험 유형</span><strong>{selectedType}</strong></div><div><span>통행 가능 여부</span><strong>휠체어 {passability.wheelchair} · 유모차 {passability.stroller} · 보행 {passability.walking}</strong></div><div><span>심각도</span><strong>{severity}단계</strong></div>{memo && <div><span>메모</span><strong>{memo}</strong></div>}</div><p className="demo-storage-note"><InfoIcon />{sharedReportsEnabled ? '제보 위치·내용·사진은 공개 공유 서버에 저장됩니다. 이메일은 공유되지 않아요.' : '공유 DB 연결 전이라 제보는 이 브라우저에만 저장됩니다.'}</p></section>}
        </div>
        {error && <p className="wizard-error" role="alert">{error}</p>}
        <div className="wizard-actions">{step > 1 ? <Button variant="secondary" aria-label="이전 단계" onClick={() => { setError(''); setStep((current) => current - 1) }}><ArrowLeft size={17} />이전</Button> : <Button variant="secondary" aria-label="지도 탭으로 돌아가기" onClick={onClose}><ArrowLeft size={17} />지도</Button>}{step < 6 ? <Button variant="primary" aria-label="다음 단계" onClick={nextStep}>다음 단계<ArrowRight size={17} /></Button> : <Button variant="primary" aria-label="확인하고 제보 등록" aria-live="polite" disabled={busy} onClick={submitReport}>{busy ? '저장 중...' : '확인하고 제보 등록'}<ArrowRight size={17} /></Button>}</div>
      </>}

      {view === 'complete' && completed && <section className="report-complete" aria-live="polite"><div className="complete-icon"><Check size={31} /></div><p className="eyebrow">제보 완료</p><h2 tabIndex={-1}>{completed.merged ? <>이미 등록된 위험 지점에<br />제보가 더해졌어요.</> : '위험 정보를 등록했어요.'}</h2><p className="complete-description">{completed.report.hazardTitle}<br />{completed.shared ? '위치·내용·사진을 공유 서버에 저장했어요.' : '이 기기에 저장했어요. 다른 사람에게는 아직 공유되지 않았습니다.'}</p>{!completed.shared && <p className="wizard-error" role="status">{sharingWarning || 'Supabase 서버 연결을 확인하지 못해 기기에만 저장했어요.'}</p>}<div className="complete-state"><FileClock size={18} /><span>안전신문고 신고는 아직 대기 중이에요.</span></div><Button variant="primary" className="wide-button" aria-label="안전신문고로 신고하기" onClick={openSafetyReport}>안전신문고로 신고하기 <ChevronRight size={17} /></Button><Button variant="secondary" className="wide-button" aria-label="나중에 신고하고 내 제보 목록 보기" onClick={saveForLater}>나중에 신고하기 <ArrowRight size={17} /></Button><button className="wizard-back-link" aria-label="새 위험 제보 작성" onClick={resetWizard}>새 제보 작성</button></section>}
    </section>
  )
}

function PhotoPicker({ title, description, photo, busy, onChange }: { title: string; description: string; photo: PhotoDraft | null; busy: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <label className={`photo-picker ${photo ? 'has-photo' : ''}`}>
    <input type="file" accept="image/*" capture="environment" onChange={onChange} aria-label={`${title} 사진 선택`} />
    {photo ? <><img src={photo.dataUrl} alt={`${title} 미리보기`} /><span className="photo-picker-change" role="status" aria-live="polite"><Check size={15} /> 사진 준비됨 · {photo.width}×{photo.height}px</span><span className="photo-picker-title">{title}</span></> : <><span className="photo-picker-icon" aria-hidden="true">{busy ? <Upload size={23} /> : <ImagePlus size={23} />}</span><strong role={busy ? 'status' : undefined} aria-live={busy ? 'polite' : undefined}>{busy ? '사진을 줄이고 있어요' : title}</strong><span>{description}</span><span className="photo-picker-action">사진 선택</span></>}
  </label>
}

function InfoIcon() { return <Info size={18} aria-hidden="true" /> }
function CrosshairIcon() { return <MapPin size={18} aria-hidden="true" /> }
