import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Footprints, MapPin, Navigation, Pause, ShieldAlert, Volume2, X } from 'lucide-react'
import { Button } from './ui/button'
import type { Coordinates } from '../map/MapContext'
import { readHazards, type Hazard } from '../map/hazards'
import { addAlertLog, latestAlertTime, updateLatestAlertLog } from '../map/alertsLog'
import { haversineMeters, hazardSpeech, isHazardRelevant, type WalkUserType } from '../map/walkSafety'

type GeolocationSample = Coordinates & { accuracy: number; speed: number | null }
type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener: (event: 'release', callback: () => void) => void }
type Props = {
  active: boolean
  moving: boolean
  onMovingChange: (moving: boolean) => void
  userType: WalkUserType
  voiceRate: number
  warningRadius: number
  testMode: boolean
  testLocation: Coordinates | null
  onTestLocationChange: (coordinates: Coordinates) => void
  onLocationUpdate: (coordinates: Coordinates) => void
  onReportHazard: (hazard: Hazard) => void
  onAlreadyFixed: (hazard: Hazard) => void
  onLater: (hazard: Hazard) => void
  onToast: (message: string) => void
}

const cityHall: Coordinates = { lat: 36.3504, lng: 127.3845 }
const testStartOffsetMeters = 30

export function WalkModePanel({
  active, moving, onMovingChange, userType, voiceRate, warningRadius, testMode, testLocation,
  onTestLocationChange, onLocationUpdate, onReportHazard, onAlreadyFixed, onLater, onToast,
}: Props) {
  const [wakeLockUnavailable, setWakeLockUnavailable] = useState(false)
  const [positionInaccurate, setPositionInaccurate] = useState(false)
  const [warning, setWarning] = useState<{ hazard: Hazard; message: string } | null>(null)
  const [questionHazard, setQuestionHazard] = useState<Hazard | null>(null)
  const [gpsLabel, setGpsLabel] = useState('현재 위치 확인 대기')
  const watchIdRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const activeHazardsRef = useRef<Hazard[]>([])
  const lastLoadLocationRef = useRef<Coordinates | null>(null)
  const lastPositionRef = useRef<{ coordinates: Coordinates; time: number } | null>(null)
  const lastSpeedRef = useRef<number>(1)
  const lastAlertAtRef = useRef<Map<string, number>>(new Map())
  const enteredHazardsRef = useRef<Map<string, Hazard>>(new Map())
  const passedQueueRef = useRef<Hazard[]>([])
  const questionRef = useRef<Hazard | null>(null)
  const stationaryTimerRef = useRef<number | null>(null)
  const stationarySinceRef = useRef<number | null>(null)
  const inaccurateAlertedRef = useRef(false)
  const movingRef = useRef(moving)
  const processPositionRef = useRef<(sample: GeolocationSample) => void>(() => {})

  movingRef.current = moving

  function say(text: string) {
    if (!('speechSynthesis' in window)) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ko-KR'
    utterance.rate = voiceRate
    window.speechSynthesis.speak(utterance)
  }

  function playWarningSound() {
    try {
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      void context.resume()
      const now = context.currentTime
      for (let index = 0; index < 2; index += 1) {
        const start = now + index * 0.32
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = 840
        gain.gain.setValueAtTime(0.001, start)
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.025)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.17)
      }
    } catch {
      // Audio warnings are optional when the browser blocks Web Audio.
    }
  }

  function emitWarning(hazard: Hazard, distance: number) {
    const message = hazardSpeech(hazard, userType, distance)
    const now = Date.now()
    const lastAlertAt = lastAlertAtRef.current.get(hazard.id) ?? latestAlertTime(hazard.id)
    if (now - lastAlertAt < 10 * 60 * 1000) return
    lastAlertAtRef.current.set(hazard.id, now)
    addAlertLog(hazard.id, userType)
    setWarning({ hazard, message })
    say(message)
    playWarningSound()
    if ('vibrate' in navigator) navigator.vibrate([300, 150, 300])
    window.setTimeout(() => setWarning((current) => current?.hazard.id === hazard.id ? null : current), 9000)
  }

  function showReportQuestion(hazard: Hazard) {
    if (questionRef.current) return
    questionRef.current = hazard
    setQuestionHazard(hazard)
    say('방금 지나온 위험 구간이 아직 있었나요? 신고하시겠어요?')
    updateLatestAlertLog(hazard.id, { asked_to_report: true })
  }

  function maybeAskAfterStop(speed: number) {
    lastSpeedRef.current = speed
    if (speed > 0.5 || passedQueueRef.current.length === 0 || questionRef.current) {
      stationarySinceRef.current = null
      if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
      stationaryTimerRef.current = null
      return
    }
    stationarySinceRef.current ??= Date.now()
    if (stationaryTimerRef.current !== null) return
    stationaryTimerRef.current = window.setTimeout(() => {
      stationaryTimerRef.current = null
      if (movingRef.current && lastSpeedRef.current <= 0.5 && passedQueueRef.current.length && !questionRef.current) {
        showReportQuestion(passedQueueRef.current[0])
      }
    }, Math.max(0, 5000 - (Date.now() - stationarySinceRef.current)))
  }

  processPositionRef.current = (sample) => {
    if (sample.accuracy > 50) {
      onLocationUpdate({ lat: sample.lat, lng: sample.lng, accuracy: sample.accuracy })
      setPositionInaccurate(true)
      setGpsLabel(`위치가 부정확합니다 · 약 ${Math.round(sample.accuracy)}m`)
      if (!inaccurateAlertedRef.current) {
        inaccurateAlertedRef.current = true
        say('위치가 부정확합니다')
      }
      return
    }
    setPositionInaccurate(false)
    setGpsLabel(`위치 정확도 약 ${Math.max(1, Math.round(sample.accuracy))}m`)
    const current = { lat: sample.lat, lng: sample.lng }
    onLocationUpdate({ ...current, accuracy: sample.accuracy })
    const previous = lastPositionRef.current
    const timestamp = Date.now()
    const speed = sample.speed ?? (previous ? haversineMeters(previous.coordinates, current) / Math.max(0.1, (timestamp - previous.time) / 1000) : 0)
    lastPositionRef.current = { coordinates: current, time: timestamp }
    maybeAskAfterStop(speed)

    if (!lastLoadLocationRef.current || haversineMeters(lastLoadLocationRef.current, current) >= 300) {
      const nearby = readHazards().filter((hazard) =>
        hazard.status !== 'fixed'
          && hazard.status !== '처리완료'
          && haversineMeters(current, hazard) <= 1000,
      )
      activeHazardsRef.current = nearby
      lastLoadLocationRef.current = current
    }

    const candidates = new Map(activeHazardsRef.current.map((hazard) => [hazard.id, hazard]))
    enteredHazardsRef.current.forEach((hazard, id) => candidates.set(id, hazard))
    candidates.forEach((hazard) => {
      if (!isHazardRelevant(hazard, userType)) return
      const distance = haversineMeters(current, hazard)
      if (distance <= warningRadius) {
        enteredHazardsRef.current.set(hazard.id, hazard)
        emitWarning(hazard, distance)
      } else if (distance > warningRadius + 20 && enteredHazardsRef.current.has(hazard.id)) {
        enteredHazardsRef.current.delete(hazard.id)
        if (!passedQueueRef.current.some((item) => item.id === hazard.id)) passedQueueRef.current.push(hazard)
        maybeAskAfterStop(speed)
      }
    })
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      void wakeLockRef.current.release()
      wakeLockRef.current = null
    }
  }

  function stopWalk() {
    movingRef.current = false
    onMovingChange(false)
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    releaseWakeLock()
    window.speechSynthesis?.cancel()
    if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
    stationaryTimerRef.current = null
  }

  async function keepScreenAwake() {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!wakeLock) {
      setWakeLockUnavailable(true)
      return
    }
    try {
      wakeLockRef.current = await wakeLock.request('screen')
      setWakeLockUnavailable(false)
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null
        if (movingRef.current) setWakeLockUnavailable(true)
      })
    } catch {
      setWakeLockUnavailable(true)
    }
  }

  function startWalk() {
    if (movingRef.current) return
    // Start speech in the same user gesture to unlock iOS speech playback.
    window.speechSynthesis?.cancel()
    say('보행 모드를 시작합니다')
    try {
      audioContextRef.current ??= new AudioContext()
      void audioContextRef.current.resume()
    } catch {
      // Speech and vibration remain available if Web Audio is unavailable.
    }
    movingRef.current = true
    onMovingChange(true)
    setWarning(null)
    setQuestionHazard(null)
    questionRef.current = null
    passedQueueRef.current = []
    enteredHazardsRef.current = new Map()
    lastAlertAtRef.current = new Map()
    lastLoadLocationRef.current = null
    lastPositionRef.current = null
    inaccurateAlertedRef.current = false
    setPositionInaccurate(false)
    void keepScreenAwake()

    if (testMode) {
      const origin = testLocation ?? cityHall
      const nearest = readHazards()
        .filter((hazard) => isHazardRelevant(hazard, userType))
        .map((hazard) => ({ hazard, distance: haversineMeters(origin, hazard) }))
        .filter(({ distance }) => distance <= 1000)
        .sort((first, second) => first.distance - second.distance)[0]?.hazard
      const longitudeOffset = testStartOffsetMeters / (111320 * Math.cos((nearest?.lat ?? origin.lat) * Math.PI / 180))
      const start = nearest
        ? { lat: nearest.lat, lng: nearest.lng + longitudeOffset }
        : origin
      onTestLocationChange(start)
      processPositionRef.current({ ...start, accuracy: 5, speed: 0 })
      return
    }
    if (!navigator.geolocation) {
      say('현재 위치를 사용할 수 없습니다. 위치 기능을 확인해 주세요.')
      onToast('현재 위치를 확인할 수 없어 보행 모드를 멈췄어요.')
      stopWalk()
      return
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => processPositionRef.current({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, speed: coords.speed }),
      () => {
        say('현재 위치를 확인할 수 없습니다. 안전한 곳에서 다시 시도해 주세요.')
        onToast('위치 권한을 확인해 주세요.')
        stopWalk()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
  }

  function answerQuestion(answer: 'yes' | 'fixed' | 'later') {
    const hazard = questionRef.current
    if (!hazard) return
    updateLatestAlertLog(hazard.id, { asked_to_report: true, answered_yes: answer === 'yes' })
    passedQueueRef.current = passedQueueRef.current.filter((item) => item.id !== hazard.id)
    questionRef.current = null
    setQuestionHazard(null)
    if (answer === 'yes') onReportHazard(hazard)
    if (answer === 'fixed') onAlreadyFixed(hazard)
    if (answer === 'later') onLater(hazard)
  }

  function moveTestLocation(direction: 'north' | 'south' | 'east' | 'west') {
    const from = testLocation ?? cityHall
    const latitudeOffset = 10 / 111320
    const longitudeOffset = 10 / (111320 * Math.cos(from.lat * Math.PI / 180))
    const next = {
      lat: from.lat + (direction === 'north' ? latitudeOffset : direction === 'south' ? -latitudeOffset : 0),
      lng: from.lng + (direction === 'east' ? longitudeOffset : direction === 'west' ? -longitudeOffset : 0),
    }
    onTestLocationChange(next)
  }

  useEffect(() => {
    if (moving && testMode && testLocation) processPositionRef.current({ ...testLocation, accuracy: 5, speed: 1 })
  }, [moving, testLocation, testMode])

  useEffect(() => {
    if (!moving) return
    const onTap = () => {
      if (!questionRef.current && passedQueueRef.current.length) showReportQuestion(passedQueueRef.current[0])
    }
    document.addEventListener('pointerdown', onTap)
    return () => document.removeEventListener('pointerdown', onTap)
  }, [moving])

  useEffect(() => {
    if (!active || moving) return
    const frame = window.requestAnimationFrame(() => document.getElementById('walk-mode-title')?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [active, moving])

  useEffect(() => {
    if (!questionHazard) return
    const dialog = document.querySelector<HTMLElement>('.walk-question-sheet')
    if (!dialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => item.getClientRects().length > 0)
    const frame = window.requestAnimationFrame(() => getFocusable()[0]?.focus())
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        answerQuestion('later')
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
  }, [questionHazard])

  useEffect(() => {
    if (moving) return
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    releaseWakeLock()
  }, [moving])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && moving && !wakeLockRef.current) void keepScreenAwake()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [moving])

  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current)
    releaseWakeLock()
    if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
  }, [])

  return <>
    <section className="walk-mode-panel" aria-labelledby="walk-mode-title">
      {!moving ? <div className="walk-start-view"><div className="walk-emblem"><Footprints size={29} /></div><p className="eyebrow">위치 기반 음성 안내</p><h1 id="walk-mode-title" tabIndex={-1}>주변 위험을<br />미리 알려드려요.</h1><p className="walk-intro">휴대전화를 안전하게 들고, 소리에 귀 기울여 주세요.</p><Button variant="primary" className="walk-start-button" aria-label="보행 시작" onClick={startWalk}><Navigation size={27} fill="currentColor" /><span>보행 시작</span><small>누르면 음성 안내가 시작돼요</small></Button><p className="walk-privacy"><ShieldAlert size={16} />위치와 이동 경로는 기기에서만 확인해요.</p></div> : <div className="walk-live-view"><div className="walk-live-heading"><span className="live-dot" />보행 안내 중</div><div className={`walk-location-status ${positionInaccurate ? 'inaccurate' : ''}`} role="status" aria-live="polite"><MapPin size={19} /><span>{gpsLabel}</span></div>{wakeLockUnavailable && <p className="wake-lock-help" role="status" aria-live="polite">화면을 켠 상태로 사용해 주세요.</p>}{warning ? <div className="walk-warning-card"><span className="warning-icon"><AlertTriangle size={31} /></span><p className="warning-hazard-name">{warning.hazard.type} 위험</p><h2>{warning.message}</h2><button type="button" aria-label="경고 음성 다시 듣기" onClick={() => say(warning.message)}><Volume2 size={19} />다시 듣기</button><div className="assertive-warning" aria-live="assertive" aria-atomic="true">{warning.message}</div></div> : <div className="walk-scanning"><span className="scan-rings"><Navigation size={30} /></span><strong>{positionInaccurate ? '위치가 부정확합니다' : '주변 위험을 확인하고 있어요.'}</strong><span>{testMode ? '테스트 위치 모드' : '주변 1km 위험 지점 확인'}</span></div>}{testMode && <div className="test-direction-pad" role="group" aria-label="테스트 위치를 10미터씩 이동"><span className="direction-spacer" /><Button variant="secondary" aria-label="테스트 위치를 북쪽으로 10미터 이동" onClick={() => moveTestLocation('north')}><ArrowUp size={19} />북쪽 10m</Button><Button variant="secondary" aria-label="테스트 위치를 서쪽으로 10미터 이동" onClick={() => moveTestLocation('west')}><ArrowLeft size={19} />서쪽 10m</Button><span className="test-distance-label" aria-hidden="true">10m</span><Button variant="secondary" aria-label="테스트 위치를 동쪽으로 10미터 이동" onClick={() => moveTestLocation('east')}><ArrowRight size={19} />동쪽 10m</Button><span className="direction-spacer" /><Button variant="secondary" aria-label="테스트 위치를 남쪽으로 10미터 이동" onClick={() => moveTestLocation('south')}><ArrowDown size={19} />남쪽 10m</Button></div>}<Button variant="danger" className="walk-stop-button" aria-label="보행 모드 멈추기" onClick={stopWalk}><Pause size={19} />보행 멈추기</Button></div>}
    </section>
    {questionHazard && <div className="walk-question-backdrop"><section className="walk-question-sheet" role="dialog" aria-modal="true" aria-labelledby="passed-question-title" aria-describedby="passed-question-description"><div className="sheet-grabber" aria-hidden="true" /><div className="question-symbol"><AlertTriangle size={26} /></div><p className="eyebrow">위험 구간 통과</p><h2 id="passed-question-title" tabIndex={-1}>방금 지나온 위험 구간이 아직 있었나요?</h2><p id="passed-question-description">{questionHazard.type} · {questionHazard.place || questionHazard.title}</p><div className="question-actions"><Button variant="primary" aria-label="예, 신고할게요" onClick={() => answerQuestion('yes')}>예, 신고할게요<ArrowUp size={18} /></Button><Button variant="secondary" aria-label="이미 고쳐졌어요" onClick={() => answerQuestion('fixed')}><Check size={18} />이미 고쳐졌어요</Button><Button variant="secondary" aria-label="나중에 답하기" onClick={() => answerQuestion('later')}><X size={18} />나중에</Button></div></section></div>}
  </>
}
