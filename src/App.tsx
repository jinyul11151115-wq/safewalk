import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Accessibility, AlertTriangle, ArrowRight, Check, Copy, FileClock, PanelLeftClose, PanelLeftOpen,
  Footprints, Info, MapPin, Search, Settings2, ShieldCheck, Volume2, X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { MapPanel } from './components/MapPanel'
import { ReportWizard, resizePhoto, type PhotoDraft } from './components/ReportWizard'
import { SafetyReportScreen } from './components/SafetyReportScreen'
import { MySafetyReports } from './components/MySafetyReports'
import { WalkModePanel } from './components/WalkModePanel'
import { useMapContext, type Coordinates } from './map/MapContext'
import { demoHazards, hazardStatusLabel, hazardTypeLabels, readHazards, writeHazards, type Hazard, type HazardStatus, type HazardType } from './map/hazards'
import { loadDemoPhotoUrl, saveDemoPhotos } from './map/demoPhotoStorage'
import { getSharedPhotoUrl, readSharedHazards, sharedReportsEnabled, subscribeToSharedReports } from './map/sharedReports'
import { defaultWarningRadii, walkUserTypes, type WalkUserType } from './map/walkSafety'
import { getOrCreatePendingSafetyReport, readSafetyReports, writeSafetyReports, type SafetyReport } from './map/safetyReports'

type AppTab = 'map' | 'report' | 'walk' | 'my-reports' | 'safety'
type VoiceSpeed = 'slow' | 'normal' | 'fast'
type TextSize = 'normal' | 'large' | 'very-large'
type ThemePreference = 'system' | 'light' | 'dark'
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function readWarningRadii(): Record<WalkUserType, number> {
  try {
    return { ...defaultWarningRadii, ...JSON.parse(localStorage.getItem('safe-walk-warning-radii') ?? '{}') }
  } catch {
    return defaultWarningRadii
  }
}

function App() {
  const { currentLocation, moveToMyLocation, updateCurrentLocation } = useMapContext()
  const [activeTab, setActiveTab] = useState<AppTab>('map')
  const [moving, setMoving] = useState(false)
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null)
  const [safetyHazard, setSafetyHazard] = useState<Hazard | null>(null)
  const [focusReceiptInput, setFocusReceiptInput] = useState(false)
  const [safetyReports, setSafetyReports] = useState<SafetyReport[]>(readSafetyReports)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [firstNotice, setFirstNotice] = useState(() => localStorage.getItem('safe-walk-notice') !== 'seen')
  const [typeFilter, setTypeFilter] = useState<HazardType | '전체 유형'>('전체 유형')
  const [statusFilter, setStatusFilter] = useState<HazardStatus | '전체 상태'>('전체 상태')
  const [search, setSearch] = useState('')
  const [locationLabel, setLocationLabel] = useState('대전시청 부근')
  const [hazards, setHazards] = useState<Hazard[]>(readHazards)
  const [sharingState, setSharingState] = useState<'loading' | 'connected' | 'local' | 'error'>(sharedReportsEnabled ? 'loading' : 'local')
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null)
  const [reportLocation, setReportLocation] = useState<Coordinates | null>({ lat: 36.3504, lng: 127.3845 })
  const [reportStep, setReportStep] = useState(1)
  const [reportMapHeight, setReportMapHeight] = useState(112)
  const [reportMapOpen, setReportMapOpen] = useState(false)
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)
  const [positionAdjusted, setPositionAdjusted] = useState(false)
  const [demoLoggedIn, setDemoLoggedIn] = useState(() => Boolean(localStorage.getItem('safe-walk-demo-user')))
  const [toast, setToast] = useState('')
  const [walkUserType, setWalkUserType] = useState<WalkUserType>(() => {
    const saved = localStorage.getItem('safe-walk-user-type')
    return saved === '휠체어' || saved === '시각장애' || saved === '고령자·유모차' ? saved : '일반'
  })
  const [warningRadii, setWarningRadii] = useState(readWarningRadii)
  const [testMode, setTestMode] = useState(() => localStorage.getItem('safe-walk-test-mode') === 'true')
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>(() => {
    const saved = localStorage.getItem('safe-walk-voice-speed')
    return saved === 'slow' || saved === 'fast' ? saved : 'normal'
  })
  const [textSize, setTextSize] = useState<TextSize>(() => {
    const saved = localStorage.getItem('safe-walk-text-size')
    return saved === 'large' || saved === 'very-large' ? saved : 'normal'
  })
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('safe-walk-theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [testLocation, setTestLocation] = useState<Coordinates | null>(null)
  const [fixedHazard, setFixedHazard] = useState<Hazard | null>(null)
  const [fixedModalOpen, setFixedModalOpen] = useState(false)
  const [fixedPhoto, setFixedPhoto] = useState<PhotoDraft | null>(null)
  const [fixedPhotoBusy, setFixedPhotoBusy] = useState(false)
  const fixedHazardRef = useRef<Hazard | null>(null)

  useEffect(() => {
    if (!firstNotice && !settingsOpen && !fixedModalOpen) return
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .filter((dialog) => dialog.getClientRects().length > 0)
    const dialog = dialogs[dialogs.length - 1]
    if (!dialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => item.getClientRects().length > 0)
    const frame = window.requestAnimationFrame(() => getFocusable()[0]?.focus())
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (fixedModalOpen) setFixedModalOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (firstNotice) closeNotice()
        return
      }
      if (event.key !== 'Tab') return
      const items = getFocusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', trapFocus, true)
      previousFocus?.focus?.()
    }
  }, [firstNotice, fixedModalOpen, settingsOpen])

  useEffect(() => {
    if (currentLocation && !testMode) {
      setLocationLabel('현재 위치 · 기기에서만 확인')
      setReportLocation((previous) => positionAdjusted ? previous : currentLocation)
    }
  }, [currentLocation, positionAdjusted, testMode])

  useEffect(() => {
    if (!sharedReportsEnabled) return
    let active = true
    const refreshSharedReports = async () => {
      try {
        const shared = await readSharedHazards()
        if (!active) return
        setHazards((current) => {
          const sharedIds = new Set(shared.map((hazard) => hazard.id))
          const localOnly = current.filter((hazard) => !hazard.id.startsWith('demo-') && !sharedIds.has(hazard.id))
          const next = [...demoHazards, ...shared, ...localOnly]
          writeHazards(next)
          return next
        })
        setSharingState('connected')
      } catch {
        if (active) setSharingState('error')
      }
    }
    void refreshSharedReports()
    const unsubscribe = subscribeToSharedReports(() => { void refreshSharedReports() })
    const fallbackRefresh = window.setInterval(() => { void refreshSharedReports() }, 30000)
    return () => {
      active = false
      unsubscribe()
      window.clearInterval(fallbackRefresh)
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'report') setReportMapOpen(false)
  }, [activeTab])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    applyTheme()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', applyTheme)
      return () => media.removeEventListener('change', applyTheme)
    }
    media.addListener(applyTheme)
    return () => media.removeListener(applyTheme)
  }, [theme])

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstallPrompt(null)
      setToast('안심보행을 홈 화면에 추가했어요.')
      window.setTimeout(() => setToast(''), 4000)
    }
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'safety' && focusReceiptInput) return
    const selector = activeTab === 'map'
      ? '.map-side-content h1'
      : activeTab === 'report'
        ? '.report-side-content h1'
        : activeTab === 'safety'
          ? '.safety-side-content h1'
          : activeTab === 'my-reports'
            ? '.my-reports-side-content h1'
            : '.walk-mode-content h1'
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, demoLoggedIn, focusReceiptInput])

  useEffect(() => {
    if (activeTab !== 'map' || !selectedHazardId) return
    const frame = window.requestAnimationFrame(() => document.getElementById('hazard-sheet-title')?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, selectedHazardId])

  const handleGpsLocation = useCallback((coordinates: Coordinates) => {
    setReportLocation(coordinates)
    setPositionAdjusted(false)
  }, [])

  const handleMapPinMove = useCallback((coordinates: Coordinates) => {
    setReportLocation(coordinates)
    setPositionAdjusted(true)
  }, [])

  function setReportMapHeightFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const workspace = event.currentTarget.closest('.workspace.report-mode')
    if (!workspace) return
    const bounds = workspace.getBoundingClientRect()
    const maximum = Math.min(window.innerHeight * 0.48, bounds.height * 0.55)
    setReportMapHeight(Math.max(112, Math.min(maximum, bounds.bottom - event.clientY)))
  }

  function handleReportMapResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      setReportMapHeight((height) => Math.min(Math.min(window.innerHeight * 0.48, window.innerHeight * 0.55), height + 32))
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      setReportMapHeight((height) => Math.max(112, height - 32))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setReportMapHeight(112)
    } else if (event.key === 'End') {
      event.preventDefault()
      setReportMapHeight(Math.min(window.innerHeight * 0.48, window.innerHeight * 0.55))
    }
  }

  const handleHazardsChange = useCallback((nextHazards: Hazard[]) => {
    setHazards(nextHazards)
    writeHazards(nextHazards)
  }, [])

  const handleTestLocation = useCallback((coordinates: Coordinates) => {
    setTestLocation(coordinates)
    setLocationLabel('테스트 위치 · 지도에서 선택')
  }, [])

  const handleDemoAuthChange = useCallback((loggedIn: boolean) => {
    setDemoLoggedIn(loggedIn)
    if (loggedIn && fixedHazardRef.current) setFixedModalOpen(true)
    if (!loggedIn) setFixedModalOpen(false)
  }, [])

  function updateUserType(type: WalkUserType) {
    setWalkUserType(type)
    localStorage.setItem('safe-walk-user-type', type)
  }

  function updateVoiceSpeed(speed: VoiceSpeed) {
    setVoiceSpeed(speed)
    localStorage.setItem('safe-walk-voice-speed', speed)
  }

  function updateTextSize(size: TextSize) {
    setTextSize(size)
    localStorage.setItem('safe-walk-text-size', size)
  }

  function updateTheme(themePreference: ThemePreference) {
    setTheme(themePreference)
    localStorage.setItem('safe-walk-theme', themePreference)
  }

  async function installPwa() {
    if (!installPrompt) {
      setToast('안드로이드 Chrome 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요.')
      window.setTimeout(() => setToast(''), 5000)
      return
    }
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    setInstallPrompt(null)
    setToast(result.outcome === 'accepted' ? '안심보행 설치를 시작했어요.' : '설치를 취소했어요.')
    window.setTimeout(() => setToast(''), 4000)
  }

  function updateWarningRadius(radius: number) {
    const next = { ...warningRadii, [walkUserType]: radius }
    setWarningRadii(next)
    localStorage.setItem('safe-walk-warning-radii', JSON.stringify(next))
  }

  function toggleTestLocation(enabled: boolean) {
    setTestMode(enabled)
    localStorage.setItem('safe-walk-test-mode', String(enabled))
    setLocationLabel(enabled ? '테스트 위치를 지도에서 선택해 주세요' : currentLocation ? '현재 위치 · 기기에서만 확인' : '대전시청 부근')
    if (enabled) {
      setToast('지도에서 테스트 위치를 눌러 선택해 주세요.')
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  function openSafetyReport(hazard: Hazard, focusReceipt = false) {
    setMoving(false)
    setSelectedHazardId(hazard.id)
    setSafetyHazard(hazard)
    setFocusReceiptInput(focusReceipt)
    setActiveTab('safety')
  }

  function openReportDialog() {
    const target = selectedHazard ?? shownHazards[0]
    if (!target) {
      setToast('신고할 위험 지점을 먼저 선택해 주세요.')
      window.setTimeout(() => setToast(''), 4000)
      return
    }
    openSafetyReport(target)
  }

  function handleWalkReport(hazard: Hazard) {
    openSafetyReport(hazard)
  }

  function ensurePendingSafetyReport(hazard: Hazard) {
    const pending = getOrCreatePendingSafetyReport(hazard)
    setSafetyReports(readSafetyReports())
    return pending
  }

  function registerSafetyReceipt(hazard: Hazard, pendingId: string | null, receiptNumber: string) {
    let next: SafetyReport[]
    let report = pendingId ? safetyReports.find((item) => item.id === pendingId) ?? null : null
    if (!report) report = getOrCreatePendingSafetyReport(hazard)
    next = readSafetyReports().map((item) => item.id === report?.id
      ? { ...item, receipt_number: receiptNumber, reported_at: new Date().toISOString() }
      : item)
    const saved = writeSafetyReports(next)
    setSafetyReports(next)
    if (saved) {
      handleHazardsChange(hazards.map((item) => item.id === hazard.id ? {
        ...item,
        status: 'reported' as const,
        receipt_numbers: [...(item.receipt_numbers ?? []), receiptNumber],
      } : item))
      return next.find((item) => item.id === report?.id) ?? null
    }
    return null
  }

  function handleAlreadyFixed(hazard: Hazard) {
    setMoving(false)
    fixedHazardRef.current = hazard
    setFixedHazard(hazard)
    setFixedPhoto(null)
    if (demoLoggedIn) setFixedModalOpen(true)
    else {
      setActiveTab('report')
      setToast('처리완료 확인은 로그인 후 이용할 수 있어요.')
      window.setTimeout(() => setToast(''), 4000)
    }
  }

  function savePendingWalkReport(hazard: Hazard) {
    const key = 'safe-walk-demo-my-reports-v1'
    try {
      const current = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>
      const email = localStorage.getItem('safe-walk-demo-user') ?? '기기 사용자'
      const pending = {
        id: crypto.randomUUID(),
        hazardId: hazard.id,
        hazardTitle: hazard.title,
        userEmail: email,
        userId: email,
        photos: [],
        passability: hazard.passability ?? { wheelchair: hazard.wheelchair ? '지나갈 수 있음' : '어려움', stroller: hazard.stroller ? '지나갈 수 있음' : '어려움', walking: hazard.walking ? '지나갈 수 있음' : '어려움' },
        severity: hazard.severity ?? 1,
        memo: hazard.memo ?? '',
        status: '신고 대기',
        created_at: new Date().toISOString(),
      }
      localStorage.setItem(key, JSON.stringify([pending, ...current]))
      setToast('신고 대기 목록에 이 위험 지점을 저장했어요.')
    } catch {
      setToast('브라우저 저장 공간을 사용할 수 없어요.')
    }
    window.setTimeout(() => setToast(''), 4000)
  }

  async function chooseFixedPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFixedPhotoBusy(true)
    try {
      setFixedPhoto(await resizePhoto(file))
    } catch (error) {
      setToast(error instanceof Error ? error.message : '사진을 불러오지 못했어요.')
    } finally {
      setFixedPhotoBusy(false)
    }
  }

  async function submitFixedConfirmation() {
    if (!fixedHazard || !fixedPhoto) return
    try {
      await saveDemoPhotos([fixedPhoto])
      const now = new Date().toISOString()
      const updated = hazards.map((hazard) => hazard.id === fixedHazard.id
        ? { ...hazard, status: 'fixed' as const, fixed_confirmed_at: now, last_confirmed_at: now, photos: [...hazard.photos, fixedPhoto.id] }
        : hazard)
      handleHazardsChange(updated)
      setFixedModalOpen(false)
      setFixedHazard(null)
      fixedHazardRef.current = null
      setToast('처리완료 확인 사진을 이 브라우저에 저장했어요.')
    } catch {
      setToast('사진을 저장하지 못했어요. 다시 시도해 주세요.')
    }
    window.setTimeout(() => setToast(''), 4000)
  }

  function closeNotice() {
    localStorage.setItem('safe-walk-notice', 'seen')
    setFirstNotice(false)
    window.setTimeout(() => document.querySelector<HTMLElement>('.map-side-content h1')?.focus({ preventScroll: true }), 0)
  }

  function closeNoticeAndAskLocation() {
    closeNotice()
    void moveToMyLocation().then((position) => {
      if (!position) {
        setToast('위치 없이도 대전시청 부근 지도를 볼 수 있어요. 위치 권한은 내 위치 버튼에서 다시 요청할 수 있어요.')
        window.setTimeout(() => setToast(''), 5000)
      }
    })
  }

  const shownHazards = hazards.filter((item) =>
    (visibleIds === null || visibleIds.includes(item.id))
      && (typeFilter === '전체 유형' || item.type === typeFilter)
      && (statusFilter === '전체 상태' || hazardStatusLabel(item.status) === statusFilter)
      && `${item.place} ${item.title} ${item.detail}`.includes(search),
  )
  const selectedHazard = selectedHazardId ? hazards.find((hazard) => hazard.id === selectedHazardId) ?? null : null
  const mobility = selectedHazard?.passability ?? (selectedHazard ? {
    wheelchair: selectedHazard.wheelchair ? '지나갈 수 있음' : '어려움',
    stroller: selectedHazard.stroller ? '지나갈 수 있음' : '어려움',
    walking: selectedHazard.walking ? '지나갈 수 있음' : '어려움',
  } : null)
  const selectedStatus = selectedHazard ? hazardStatusLabel(selectedHazard.status) : undefined
  const selectedStatusClass = selectedStatus === '미신고' ? 'new' : selectedStatus === '신고됨' ? 'reported' : 'resolved'

  return (
    <main className={`app-shell ${moving ? 'is-moving' : ''} ${textSize !== 'normal' ? `text-size-${textSize}` : ''} theme-${theme}`}>
      <header className="topbar">
        <a className="brand" href="#walk" aria-label="안심보행 보행 모드로 이동" onClick={(event) => { event.preventDefault(); setActiveTab('walk') }}>
          <span className="brand-mark"><Footprints size={21} strokeWidth={2.5} /></span>
          <span className="brand-copy"><strong>안심보행</strong><small>SAFE WALK · 대전 시범 운영</small></span>
        </a>
        <div className="top-location"><MapPin size={17} /><span>{locationLabel}</span></div>
        <div className="top-actions">
          <span className="pilot-badge"><span /> 대전 시범 운영</span>
          <Button variant="quiet" size="icon" aria-label="설정 열기" disabled={moving} onClick={() => setSettingsOpen(true)}><Settings2 size={20} /></Button>
        </div>
      </header>

      <nav className="app-tabs" aria-label="안심보행 화면">
        <button aria-current={activeTab === 'map' ? 'page' : undefined} className={activeTab === 'map' ? 'active' : ''} aria-label="지도 화면으로 이동" disabled={moving} onClick={() => setActiveTab('map')}><MapPin size={17} />지도</button>
        <button aria-current={activeTab === 'report' || activeTab === 'safety' ? 'page' : undefined} className={activeTab === 'report' || activeTab === 'safety' ? 'active' : ''} aria-label="제보하기 화면으로 이동" disabled={moving} onClick={() => setActiveTab('report')}><AlertTriangle size={17} />제보하기</button>
        <button aria-current={activeTab === 'walk' ? 'page' : undefined} className={activeTab === 'walk' ? 'active' : ''} aria-label="보행 모드 화면으로 이동" disabled={moving} onClick={() => setActiveTab('walk')}><Footprints size={17} />보행 모드</button>
        <button aria-current={activeTab === 'my-reports' ? 'page' : undefined} className={activeTab === 'my-reports' ? 'active' : ''} aria-label="내 신고 목록으로 이동" disabled={moving} onClick={() => setActiveTab('my-reports')}><FileClock size={17} />내 신고</button>
      </nav>

      {moving && <div className="wake-warning-banner" role="note">화면 잠금·앱 전환 중 위치 안내가 멈출 수 있어요. 돌아오면 새 위치를 확인한 뒤 다시 안내합니다.</div>}

      <div className={`workspace ${activeTab === 'map' && desktopSidebarCollapsed ? 'desktop-sidebar-collapsed' : ''} ${activeTab === 'report' ? 'report-mode' : ''} ${activeTab === 'report' && (!demoLoggedIn || reportStep !== 1 || !reportMapOpen) ? 'report-map-hidden' : ''} ${activeTab === 'safety' ? 'safety-mode' : ''} ${activeTab === 'my-reports' ? 'my-reports-mode' : ''} ${activeTab === 'walk' ? 'walk-mode' : ''}`} style={activeTab === 'report' ? { '--report-map-height': `${reportMapHeight}px` } as CSSProperties : undefined}>
        <aside id="main-map-sidebar" className={`side-panel ${activeTab === 'report' ? 'report-side-panel' : ''} ${activeTab === 'safety' ? 'safety-side-panel' : ''} ${activeTab === 'my-reports' ? 'my-reports-side-panel' : ''} ${activeTab === 'walk' ? 'walk-side-panel' : ''}`} aria-label="안심보행 탭 내용">
          <div className={`map-side-content ${activeTab === 'map' ? 'tab-content-active' : ''}`}>
            <div className="panel-heading">
              <div><p className="eyebrow">대전 시범 지도</p><h1 tabIndex={-1}>천천히, 안전하게.</h1></div>
              <div className="day-chip"><span aria-hidden="true">●</span> {sharingState === 'connected' ? '공유 DB 연결' : sharingState === 'loading' ? '공유 데이터 확인 중' : sharingState === 'error' ? '공유 DB 설정 확인' : '기기 임시 저장'}</div>
            </div>
            <p className="panel-description">지도에서 주변 보도 위험을 살펴보세요.</p>
            <div className="searchbox"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="장소나 위험 내용을 검색" aria-label="장소나 위험 내용 검색" /><Button variant="quiet" size="icon" aria-label="검색 지우기" onClick={() => setSearch('')}><X size={17} /></Button></div>
              <div className="nearby-heading"><h2>화면 안 위험 지점 <span aria-live="polite" aria-atomic="true">{shownHazards.length}</span></h2><span className="nearby-caption">지도 범위 기준</span></div>
              <div className="hazard-list">
                {shownHazards.map((hazard) => <button type="button" id={`hazard-row-${hazard.id}`} key={hazard.id} className={`hazard-card ${selectedHazardId === hazard.id ? 'selected' : ''}`} onClick={() => setSelectedHazardId(hazard.id)} aria-label={`${hazard.place}, ${hazard.title}, 상태 ${hazardStatusLabel(hazard.status)}, 자세히 보기`}>
                  <span className={`hazard-icon status-${hazardStatusLabel(hazard.status) === '미신고' ? 'new' : hazardStatusLabel(hazard.status) === '신고됨' ? 'reported' : 'resolved'}`}><AlertTriangle size={19} /></span>
                  <span className="hazard-copy"><strong>{hazard.title}</strong><span>{hazard.place || hazard.detail}</span><small>{hazard.type} · {hazardStatusLabel(hazard.status)}</small></span>
                  <span className="hazard-distance"><ArrowRight size={16} /></span>
                </button>)}
                {shownHazards.length === 0 && <p className="empty-list">현재 지도 범위에서 위험 지점을 찾지 못했어요.</p>}
              </div>
              <div className="panel-footer-note"><Info size={16} /><span>{sharingState === 'connected' ? '새 제보는 다른 사용자와 공유돼요. 지도 표식에는 예시 데이터도 포함돼요.' : sharingState === 'error' ? 'Supabase 연결 또는 SQL 설정을 확인해 주세요. 현재 표시 데이터는 임시일 수 있어요.' : '공유 DB가 연결되기 전까지 제보는 이 브라우저에 임시 저장돼요.'}</span></div>
              <div className="panel-actions">
                <Button variant="primary" className="start-button" aria-label="보행 모드 열기" onClick={() => setActiveTab('walk')}><Footprints size={19} />보행 모드 열기 <span>음성 안내</span></Button>
                <Button variant="secondary" className="report-start" aria-label="위험 지점 신고문 만들기" onClick={openReportDialog}><AlertTriangle size={18} />안전신문고 신고문 만들기</Button>
              </div>
            <div className="support-notice"><ShieldCheck size={18} /><span>보조 정보예요. 지팡이·안내견을 대신할 수 없어요.</span></div>
          </div>
          <div className={`report-side-content ${activeTab === 'report' ? 'tab-content-active' : ''}`}>
            <ReportWizard
            active={activeTab === 'report'}
            hazards={hazards}
            onHazardsChange={handleHazardsChange}
            reportLocation={reportLocation}
            onReportLocationChange={handleGpsLocation}
            positionAdjusted={positionAdjusted}
            onStepChange={(step) => { setReportStep(step); if (step !== 1) setReportMapOpen(false) }}
            onOpenLocationMap={() => setReportMapOpen(true)}
            onLocationMapDone={() => setReportMapOpen(false)}
            onAuthChange={handleDemoAuthChange}
            onClose={() => setActiveTab('map')}
            />
          </div>
          <div className={`walk-mode-content ${activeTab === 'walk' ? 'tab-content-active' : ''}`}>
            <WalkModePanel
              active={activeTab === 'walk'}
              moving={moving}
              onMovingChange={setMoving}
              userType={walkUserType}
              voiceRate={voiceSpeed === 'slow' ? 0.75 : voiceSpeed === 'fast' ? 1.1 : 0.92}
              warningRadius={warningRadii[walkUserType]}
              testMode={testMode}
              testLocation={testLocation}
              onTestLocationChange={handleTestLocation}
              onLocationUpdate={updateCurrentLocation}
              onReportHazard={handleWalkReport}
              onAlreadyFixed={handleAlreadyFixed}
              onLater={savePendingWalkReport}
              onToast={setToast}
            />
          </div>
          <div className={`safety-side-content ${activeTab === 'safety' ? 'tab-content-active' : ''}`}>
            {safetyHazard && <SafetyReportScreen
              hazard={safetyHazard}
              pendingReport={safetyReports.find((report) => report.hazard_id === safetyHazard.id) ?? null}
              focusReceiptInput={focusReceiptInput}
              onClose={() => { setActiveTab('map'); setFocusReceiptInput(false) }}
              onToast={setToast}
              onOpenSafetyReport={ensurePendingSafetyReport}
              onRegisterReceipt={registerSafetyReceipt}
            />}
          </div>
          <div className={`my-reports-side-content ${activeTab === 'my-reports' ? 'tab-content-active' : ''}`}>
            <MySafetyReports
              active={activeTab === 'my-reports'}
              hazards={hazards}
              safetyReports={safetyReports}
              onOpenSafetyReport={(hazard, focusReceipt) => openSafetyReport(hazard, focusReceipt)}
              onConfirmFixed={handleAlreadyFixed}
            />
          </div>
        </aside>

        <div className={`map-workspace ${activeTab === 'report' || activeTab === 'safety' ? 'mini-map-workspace' : ''} ${activeTab === 'report' && reportMapOpen ? 'report-location-map-open' : ''}`} role={activeTab === 'report' && reportMapOpen ? 'dialog' : undefined} aria-modal={activeTab === 'report' && reportMapOpen ? true : undefined} aria-label={activeTab === 'report' && reportMapOpen ? '제보 위치 선택 지도' : undefined} onKeyDown={(event) => { if (event.key === 'Escape' && reportMapOpen) setReportMapOpen(false) }}>
          {activeTab === 'report' && reportMapOpen && <><div className="report-location-map-toolbar"><div><strong>제보 위치 선택</strong><span>지도를 움직여 가운데 핀을 위험 위치에 맞춰주세요.</span></div></div><div className="report-location-center-pin" aria-hidden="true"><MapPin size={42} fill="currentColor" /><span /></div><div className="report-location-coordinates" role="status" aria-live="polite">선택 위치 · {reportLocation?.lat.toFixed(5) ?? '36.35040'}, {reportLocation?.lng.toFixed(5) ?? '127.38450'}</div><div className="report-location-map-footer"><Button variant="primary" aria-label="핀 위치 선택 완료" onClick={() => setReportMapOpen(false)}><Check size={19} />핀 위치 선택 완료</Button></div></>}
          {activeTab === 'map' && <button
            type="button"
            className={`desktop-sidebar-toggle ${desktopSidebarCollapsed ? 'is-collapsed' : ''}`}
            aria-label={desktopSidebarCollapsed ? '왼쪽 메뉴 열기' : '왼쪽 메뉴 닫기'}
            aria-expanded={!desktopSidebarCollapsed}
            aria-controls="main-map-sidebar"
            onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
          >{desktopSidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>}
          {activeTab === 'report' && <div
            className="report-map-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="지도 높이 조절. 위쪽 화살표로 키우고 아래쪽 화살표로 줄이세요."
            aria-valuemin={112}
            aria-valuemax={Math.round(Math.min(window.innerHeight * 0.48, window.innerHeight * 0.55))}
            aria-valuenow={Math.round(reportMapHeight)}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setReportMapHeightFromPointer(event)
            }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setReportMapHeightFromPointer(event) }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
            onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
            onKeyDown={handleReportMapResizeKey}
          ><span aria-hidden="true" /></div>}
          <MapPanel
            hazards={hazards}
            visibleIds={visibleIds}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            onSelect={(hazard) => setSelectedHazardId(hazard.id)}
            onTypeFilter={setTypeFilter}
            onStatusFilter={setStatusFilter}
            onVisibleIds={setVisibleIds}
            onAddHazard={() => setActiveTab('report')}
            onLocationError={(message) => setToast(message || '현재 위치를 확인하지 못했어요. 위치 권한을 확인해 주세요.')}
            miniMode={activeTab === 'report' || activeTab === 'safety'}
            dragPinEnabled={activeTab === 'report' && demoLoggedIn && reportStep === 1}
            locationPickMode={activeTab === 'report' && reportMapOpen}
            reportLocation={reportLocation}
            onReportLocationChange={handleMapPinMove}
            testMode={testMode && activeTab === 'map'}
            testLocation={testLocation}
            onTestLocation={handleTestLocation}
            mapVisible={activeTab !== 'my-reports' && (activeTab !== 'walk' || moving) && (activeTab !== 'report' || (demoLoggedIn && reportStep === 1))}
            walkMode={activeTab === 'walk' && moving}
          />
          {selectedHazard && !moving && activeTab === 'map' && <section className="hazard-sheet" aria-labelledby="hazard-sheet-title">
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-heading">
              <div><span className={`sheet-type-icon status-${selectedStatusClass}`}><AlertTriangle size={20} /></span></div>
              <div className="sheet-title-group"><span className="sheet-kicker">{hazardTypeLabels[selectedHazard.type]} · {selectedHazard.type}</span><h2 id="hazard-sheet-title" tabIndex={-1}>{selectedHazard.title}</h2><span className="sheet-place"><MapPin size={14} />{selectedHazard.place}</span></div>
              <button type="button" className="sheet-close" aria-label="위험 지점 상세 닫기" onClick={() => { const id = selectedHazard.id; setSelectedHazardId(null); window.requestAnimationFrame(() => document.getElementById(`hazard-row-${id}`)?.focus()) }}><X size={19} /></button>
            </div>
            <p className="sheet-detail">{selectedHazard.detail}</p>
            <div className="sheet-meta">
              <div><span>상태</span><strong className={`status-text status-text-${selectedStatus === '미신고' ? 'new' : selectedStatus === '신고됨' ? 'reported' : 'resolved'}`}>{selectedStatus === '처리완료' && <Check size={14} />}{selectedStatus}</strong></div>
              <div><span>제보 수</span><strong>{selectedHazard.report_count}건</strong></div>
              <div><span>최근 확인</span><strong>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(selectedHazard.last_confirmed_at))}</strong></div>
            </div>
            <div className="access-row" aria-label="이동 수단별 통행 가능 여부">
              <span className={mobility?.wheelchair === '지나갈 수 있음' ? 'can-pass' : 'cannot-pass'}>{mobility?.wheelchair} · 휠체어</span>
              <span className={mobility?.stroller === '지나갈 수 있음' ? 'can-pass' : 'cannot-pass'}>{mobility?.stroller} · 유모차</span>
              <span className={mobility?.walking === '지나갈 수 있음' ? 'can-pass' : 'cannot-pass'}>{mobility?.walking} · 보행</span>
            </div>
            <HazardPhotoStrip photos={selectedHazard.photos} hazardId={selectedHazard.id} />
             <Button variant="secondary" className="sheet-report-button" aria-label={`${selectedHazard.title} 신고문 만들기`} onClick={openReportDialog}><Copy size={17} />신고문 만들기</Button>
          </section>}
        </div>
      </div>

      {activeTab === 'map' && <footer className="mobile-bottom"><Button variant="primary" className="mobile-start" aria-label="보행 모드 열기" onClick={() => setActiveTab('walk')}><Footprints size={19} /> 보행 모드 시작</Button><Button variant="secondary" size="icon" aria-label="위험 지점 신고문 만들기" onClick={openReportDialog}><AlertTriangle size={20} /></Button></footer>}

      {firstNotice && <div className="modal-backdrop" role="presentation"><section className="notice-modal" role="dialog" aria-modal="true" aria-labelledby="notice-title"><div className="notice-icon"><Accessibility size={28} /></div><p className="eyebrow">안심보행을 시작하기 전에</p><h2 id="notice-title">안전한 이동을 위한<br />보조 정보예요.</h2><p className="modal-description">위험 정보는 참고용이며, 현장 상황은 달라질 수 있어요. 지팡이와 안내견, 주변을 살피는 이동을 대신할 수 없습니다.</p><div className="privacy-callout"><ShieldCheck size={19} /><span>이동 경로는 서버에 저장하지 않아요.<br />내 위치는 이 기기에서만 확인해요.</span></div><Button variant="primary" className="modal-primary" aria-label="현재 위치 허용하고 지도 보기" onClick={closeNoticeAndAskLocation}>현재 위치 허용하고 지도 보기 <ArrowRight size={18} /></Button><button type="button" className="notice-settings-link" aria-label="위치 권한 없이 지도 보기" onClick={closeNotice}>위치 없이 지도 보기</button><button type="button" className="notice-settings-link" aria-label="접근성 설정 열기" onClick={() => { closeNotice(); setSettingsOpen(true) }}>접근성 설정 보기</button></section></div>}

      {settingsOpen && <div className="modal-backdrop" role="presentation"><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-topline"><div className="modal-heading-icon"><Settings2 size={20} /></div><button className="modal-close" aria-label="설정 창 닫기" onClick={() => setSettingsOpen(false)}><X size={20} /></button></div>
        <p className="eyebrow">나에게 맞게 설정</p><h2 id="settings-title">접근성 설정</h2><p className="modal-description">이동 중에는 화면 조작 없이 음성으로만 안내해요.</p>
        <div className="setting-row"><div className="setting-icon"><Volume2 size={19} /></div><div><strong>음성 안내</strong><span>한국어 음성으로 위험을 알려드려요.</span></div><span className="setting-value">켜짐</span></div>
        <label className="walk-setting-field" htmlFor="voice-speed">음성 속도<select id="voice-speed" value={voiceSpeed} onChange={(event) => updateVoiceSpeed(event.target.value as VoiceSpeed)}><option value="slow">느리게</option><option value="normal">보통</option><option value="fast">빠르게</option></select></label>
        <label className="walk-setting-field" htmlFor="text-size">글자 크기<select id="text-size" value={textSize} onChange={(event) => updateTextSize(event.target.value as TextSize)}><option value="normal">보통</option><option value="large">크게</option><option value="very-large">아주 크게</option></select></label>
        <label className="walk-setting-field" htmlFor="theme-choice">화면 색상<select id="theme-choice" value={theme} onChange={(event) => updateTheme(event.target.value as ThemePreference)}><option value="system">기기 설정 따르기</option><option value="light">밝은 화면</option><option value="dark">어두운 화면</option></select></label>
        <label className="walk-setting-field" htmlFor="walk-user-type">보행자 유형<select id="walk-user-type" value={walkUserType} onChange={(event) => updateUserType(event.target.value as WalkUserType)}>{walkUserTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="walk-radius-setting" htmlFor="walk-warning-radius"><span><strong>미리 알림 거리</strong><b>{warningRadii[walkUserType]}m</b></span><input id="walk-warning-radius" type="range" min="10" max="100" step="10" value={warningRadii[walkUserType]} aria-label={`${walkUserType} 미리 알림 거리`} onChange={(event) => updateWarningRadius(Number(event.target.value))} /></label>
        <label className="test-mode-setting"><input type="checkbox" aria-label="테스트 위치 사용" checked={testMode} onChange={(event) => toggleTestLocation(event.target.checked)} /><span><strong>테스트 위치 사용</strong><small>지도를 눌러 내 위치를 정하고, 보행 화면에서 5m씩 움직여요.</small></span></label>
        <Button variant="primary" className="pwa-install-button" aria-label="안드로이드에 안심보행 설치" onClick={installPwa}>Android 설치 <ArrowRight size={17} /></Button>
        <details className="pwa-help"><summary>홈 화면에 추가하는 방법</summary><ul><li>아이폰: Safari의 공유 버튼을 누르고 “홈 화면에 추가”를 선택해요.</li><li>안드로이드: 위의 설치 버튼을 누르거나 Chrome 메뉴에서 “앱 설치”를 선택해요.</li></ul></details>
        <div className="settings-warning"><Info size={18} /><span>안심보행은 보조 정보예요. 지팡이·안내견을 대신하지 않으며, 현장 상황을 살펴주세요.</span></div>
        <Button variant="primary" className="modal-primary" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)}>확인</Button>
      </section></div>}


      {fixedModalOpen && fixedHazard && <div className="modal-backdrop" role="presentation"><section className="fixed-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="fixed-confirm-title"><div className="modal-topline"><div className="modal-heading-icon"><Check size={20} /></div><button type="button" className="modal-close" aria-label="처리완료 확인 닫기" onClick={() => setFixedModalOpen(false)}><X size={20} /></button></div><p className="eyebrow">로그인 사용자 확인</p><h2 id="fixed-confirm-title">위험 지점이 고쳐졌나요?</h2><p className="modal-description">“{fixedHazard.title}” 현장 사진 한 장을 올려 처리완료 확인을 보내주세요. 사진은 1600px 이하로 줄여 이 브라우저에 임시 저장해요.</p><label className="fixed-photo-picker">{fixedPhoto ? <img src={fixedPhoto.dataUrl} alt="처리완료 확인 사진 미리보기" /> : <span role="status" aria-live="polite"><MapPin size={21} />{fixedPhotoBusy ? '사진을 줄이고 있어요' : '현장 사진 한 장 선택'}</span>}<input type="file" accept="image/*" capture="environment" aria-label="처리완료 확인 사진 선택" onChange={chooseFixedPhoto} /></label><div className="demo-storage-note"><Info size={17} />데모 모드라 실제 로그인이나 서버 업로드는 연결되지 않았어요.</div><Button variant="primary" className="modal-primary" aria-label="처리완료 사진을 임시 저장하고 확인" aria-live="polite" disabled={!fixedPhoto || fixedPhotoBusy} onClick={submitFixedConfirmation}>처리완료 확인 보내기</Button></section></div>}

      {toast && <div className="toast-message" role="status" aria-live="polite">{toast}</div>}
    </main>
  )
}

function HazardPhotoStrip({ photos, hazardId }: { photos: string[]; hazardId: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    const objectUrls: string[] = []
    Promise.all(photos.filter((photo) => photo !== 'example').map(async (photo) => [photo, photo.includes('/') ? getSharedPhotoUrl(photo) : await loadDemoPhotoUrl(photo)] as const))
      .then((entries) => {
        if (!active) return
        const next: Record<string, string> = {}
        entries.forEach(([id, url]) => { if (url) { next[id] = url; objectUrls.push(url) } })
        setUrls(next)
      })
      .catch(() => setUrls({}))
    return () => { active = false; objectUrls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [photos, hazardId])

  return <div className="sheet-photos" aria-label="제보 사진">
    {photos.length ? photos.map((photo, index) => urls[photo]
      ? <div key={`${hazardId}-${photo}`} className="photo-placeholder"><img className="actual-report-photo" src={urls[photo]} alt={`제보 사진 ${index + 1}`} /></div>
      : <div key={`${hazardId}-${photo}`} className="photo-placeholder" role="img" aria-label={`제보 사진 ${index + 1}, ${photo === 'example' ? '예시 이미지' : '불러오는 중'}`}><span className="photo-road" /><span className="photo-caption">{photo === 'example' ? '시범 제보 사진' : '사진 불러오는 중'}</span></div>) : <p>등록된 제보 사진이 없어요.</p>}
  </div>
}

export default App
