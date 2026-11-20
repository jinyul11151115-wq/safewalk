import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Download, ExternalLink, Info, MapPin, ShieldCheck } from 'lucide-react'
import { Button } from './ui/button'
import { loadDemoPhotoUrl } from '../map/demoPhotoStorage'
import type { Hazard } from '../map/hazards'
import type { SafetyReport } from '../map/safetyReports'
import { resolveLocation } from '../map/region'

type PhotoView = { id: string; url: string | null }
type Props = {
  hazard: Hazard
  pendingReport: SafetyReport | null
  focusReceiptInput: boolean
  onClose: () => void
  onToast: (message: string) => void
  onOpenSafetyReport: (hazard: Hazard) => SafetyReport
  onRegisterReceipt: (hazard: Hazard, pendingId: string | null, receipt: string) => SafetyReport | null
}

function typeDescription(hazard: Hazard) {
  const rawType = String(hazard.type)
  const typeCode = hazard.type_code ?? rawType
  if (typeCode === 'root_heave') return '가로수 뿌리 융기'
  if (typeCode === 'tree_guard') return '가로수 보호틀 파손'
  const descriptions: Record<string, string> = {
    '가로수 뿌리': '가로수 뿌리 융기',
    '보도블록 파손': '보도블록 파손',
    '단차·턱': '보도 단차',
    '급경사': '급경사',
    '좁은 보도': '좁은 보도',
    '공사 장애물': '공사 장애물',
    '맨홀·배수구': '맨홀·배수구 주변 파손',
    '미끄러운 노면': '미끄러운 보도 노면',
  }
  return descriptions[rawType] ?? hazard.type
}

function mobilityFor(hazard: Hazard) {
  const wheelchairPassable = hazard.passability
    ? hazard.passability.wheelchair === '지나갈 수 있음'
    : hazard.passable_wheelchair ?? hazard.wheelchair
  const strollerPassable = hazard.passability
    ? hazard.passability.stroller === '지나갈 수 있음'
    : hazard.passable_stroller ?? hazard.stroller
  const walkingPassable = hazard.passability?.walking === '지나갈 수 있음' || hazard.walking
  const unable: string[] = []
  if (!wheelchairPassable) unable.push('휠체어 이용자')
  if (!strollerPassable) unable.push('유모차 이용자')
  if (!walkingPassable) unable.push('보행자')
  return { wheelchairPassable, targets: unable.length ? unable.join('·') : '교통약자' }
}

export function SafetyReportScreen({ hazard, pendingReport, focusReceiptInput, onClose, onToast, onOpenSafetyReport, onRegisterReceipt }: Props) {
  const [regionName, setRegionName] = useState(hazard.region_name ?? '')
  const [roadAddress, setRoadAddress] = useState('주소 확인 중')
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [copyState, setCopyState] = useState('')
  const [photos, setPhotos] = useState<PhotoView[]>([])
  const [receiptNumber, setReceiptNumber] = useState(pendingReport?.receipt_number ?? '')
  const [receiptMessage, setReceiptMessage] = useState('')
  const receiptInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setEdited(false)
    setMessage('')
    setRegionName(hazard.region_name ?? '')
    setRoadAddress('주소 확인 중')

    resolveLocation({ lat: hazard.lat, lng: hazard.lng })
      .then((location) => {
        if (!active) return
        if (!hazard.region_name) setRegionName(location.region_name)
        setRoadAddress(location.roadName || location.fullName || '주소를 확인할 수 없어요. 위치를 직접 확인해 주세요.')
      })
      .catch(() => {
        if (!active) return
        setRoadAddress('주소를 확인할 수 없어요. 위치를 직접 확인해 주세요.')
      })
    return () => { active = false }
  }, [hazard.id, hazard.lat, hazard.lng, hazard.region_name])

  useEffect(() => {
    let active = true
    const urls: string[] = []
    Promise.all(hazard.photos.filter((id) => id !== 'example').map(async (id) => ({ id, url: await loadDemoPhotoUrl(id).catch(() => null) })))
      .then((entries) => {
        if (!active) return
        entries.forEach(({ url }) => { if (url) urls.push(url) })
        setPhotos(entries)
      })
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [hazard.id, hazard.photos])

  useEffect(() => {
    if (edited) return
    const { wheelchairPassable, targets } = mobilityFor(hazard)
    const rootsNeedTreatment = ['root_heave', 'tree_guard'].includes(hazard.type_code ?? String(hazard.type)) || hazard.type === '가로수 뿌리'
    const wheelchairWarning = wheelchairPassable ? '' : ' 휠체어 이용자가 차도로 우회하고 있어 사고 위험이 큽니다.'
    const specialTreatment = rootsNeedTreatment ? ' 및 가로수 뿌리·보호틀 처리' : ''
    const region = regionName || hazard.place
    const address = roadAddress === '주소 확인 중' ? '주소 확인 중' : roadAddress
    const locationText = roadAddress && !address.startsWith(region)
      ? `${region} ${address}`
      : region
    setMessage(`[교통약자 통행 위험] ${typeDescription(hazard)}(으)로 ${targets} 통행이 어렵습니다.${wheelchairWarning} 위치: ${locationText} 부근 보도. 보도 정비${specialTreatment}를 요청드립니다.`)
  }, [edited, hazard, regionName, roadAddress])

  useEffect(() => {
    if (focusReceiptInput) receiptInputRef.current?.focus()
  }, [focusReceiptInput])

  useEffect(() => {
    setReceiptNumber(pendingReport?.receipt_number ?? '')
    setReceiptMessage('')
    setCopyState('')
  }, [hazard.id, pendingReport?.id, pendingReport?.receipt_number])

  function copyAndOpen() {
    onOpenSafetyReport(hazard)
    let settled = false
    try {
      const clipboardWrite = navigator.clipboard.writeText(message)
      window.open('https://www.safetyreport.go.kr', '_blank', 'noopener,noreferrer')
      setCopyState('복사 요청을 보냈어요. 내 신고에 접수번호 입력 대기로 저장했어요.')
      void clipboardWrite.then(() => {
        settled = true
        setCopyState('복사되었습니다. 내 신고에 접수번호 입력 대기로 저장했어요.')
      }).catch(() => {
        settled = true
        setCopyState('복사하지 못했어요. 내 신고에는 접수번호 입력 대기로 저장했어요. 신고문을 직접 복사해 주세요.')
      })
      window.setTimeout(() => {
        if (!settled) setCopyState('복사 상태를 확인할 수 없어요. 내 신고에는 접수번호 입력 대기로 저장했어요.')
      }, 2500)
    } catch {
      window.open('https://www.safetyreport.go.kr', '_blank', 'noopener,noreferrer')
      setCopyState('복사하지 못했어요. 내 신고에는 접수번호 입력 대기로 저장했어요. 신고문을 직접 복사해 주세요.')
    }
  }

  function savePhoto(photo: PhotoView, index: number) {
    if (!photo.url) return
    const link = document.createElement('a')
    link.href = photo.url
    link.download = `안심보행-제보-${hazard.id}-${index + 1}.jpg`
    link.click()
  }

  function registerReceipt() {
    const value = receiptNumber.trim()
    if (!value || !/^[A-Za-z0-9-]+$/.test(value)) {
      setReceiptMessage('접수번호 형식을 확인해 주세요.')
      onToast('접수번호 형식을 확인해 주세요.')
      window.setTimeout(() => onToast(''), 4000)
      return
    }
    const saved = onRegisterReceipt(hazard, pendingReport?.id ?? null, value)
    if (saved) {
      const receipt = saved.receipt_number ?? value
      const message = `접수번호 ${receipt}가 등록됐어요. 상태가 신고됨으로 바뀌었어요.`
      setReceiptNumber(receipt)
      setReceiptMessage(message)
      onToast(message)
      window.setTimeout(() => onToast(''), 5000)
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(message)
        utterance.lang = 'ko-KR'
        window.speechSynthesis.speak(utterance)
      }
    } else {
      setReceiptMessage('접수번호를 저장하지 못했어요.')
      onToast('접수번호를 저장하지 못했어요.')
      window.setTimeout(() => onToast(''), 4000)
    }
  }

  return <section className="safety-report-screen" aria-labelledby="safety-report-title">
    <div className="safety-screen-header"><div><p className="eyebrow">안전신문고 연결</p><h1 id="safety-report-title" tabIndex={-1}>신고문 확인</h1></div><button className="sheet-close" aria-label="지도 화면으로 돌아가기" onClick={onClose}><ArrowLeft size={19} /></button></div>
    <p className="safety-hazard-title"><MapPin size={16} />{hazard.title} · {hazard.place}</p>
    <label className="safety-message-label" htmlFor="safety-report-message">자동 생성된 신고문 <span>직접 수정할 수 있어요</span></label>
    <textarea id="safety-report-message" className="safety-message-editor" value={message} onChange={(event) => { setEdited(true); setMessage(event.target.value) }} rows={7} aria-label="수정 가능한 안전신문고 신고문 미리보기" />
    <div className="address-note" aria-live="polite" aria-atomic="true"><Info size={15} />도로명주소는 화면에만 표시하고 저장하지 않아요. <span>{regionName || hazard.region_name || ''} {roadAddress}</span></div>

    <div className="safety-photos-block"><div className="safety-section-heading"><div><h2>제보 사진 저장</h2><p>안전신문고에서 앨범 사진으로 첨부하세요.</p></div><Download size={20} /></div><div className="safety-photo-grid">{photos.length ? photos.map((photo, index) => <div key={`${photo.id}-${index}`} className="safety-photo-card">{photo.url ? <img src={photo.url} alt={`위험 지점 제보 사진 ${index + 1}`} /> : <div className="photo-unavailable"><Info size={17} />예시 사진은 저장할 수 없어요</div>}{photo.url && <Button variant="secondary" aria-label={`제보 사진 ${index + 1} 저장`} onClick={() => savePhoto(photo, index)}><Download size={15} />사진 저장</Button>}</div>) : <p className="no-safety-photos" role="status">사진 없이 신고합니다.</p>}</div></div>

    <Button variant="primary" className="safety-open-button" aria-label="신고문 복사하고 안전신문고 열기" onClick={copyAndOpen}><Copy size={19} />신고문 복사하고 안전신문고 열기<ExternalLink size={17} /></Button>
    {copyState && <p className="copy-feedback" role="status" aria-live="polite">{copyState}</p>}

    <details className="safety-help-card"><summary>안전신문고에서 신고하는 방법</summary><ol><li>“안전 신고”에서 “도로·시설물 파손 및 고장”을 선택해요.</li><li>위에서 저장한 사진을 첨부해요.</li><li>위치를 확인하고 신고 내용 칸에 복사한 글을 붙여넣어요.</li><li>내용을 확인한 뒤 직접 제출해요.</li></ol><p>신고 후 받은 접수번호를 아래에 입력해 주세요.</p></details>

    <div className="receipt-entry"><label htmlFor="safety-receipt-number">접수번호</label><div><input ref={receiptInputRef} id="safety-receipt-number" value={receiptNumber} onChange={(event) => { setReceiptNumber(event.target.value); setReceiptMessage('') }} placeholder="예: 1AB-2345-6789" pattern="[A-Za-z0-9-]+" title="영문, 숫자, 하이픈만 입력할 수 있어요." aria-label="안전신문고 접수번호 입력" /><Button variant="secondary" aria-label="접수번호 등록" onClick={registerReceipt}>등록</Button></div>{receiptMessage && <span role="status" aria-live="polite">{receiptMessage}</span>}</div>
    <p className="safety-no-api-note"><ShieldCheck size={16} />안전신문고에 자동 접수하지 않아요. 신고와 접수번호 확인은 직접 진행해 주세요.</p>
  </section>
}
