import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Footprints, MapPin, Navigation, ShieldAlert, Volume2, X } from 'lucide-react'
import { Button } from './ui/button'
import type { Coordinates } from '../map/MapContext'
import { readHazards, type Hazard } from '../map/hazards'
import { addAlertLog, updateLatestAlertLog } from '../map/alertsLog'
import { defaultWarningRadii, haversineMeters, hazardSpeech, isHazardRelevant, type WalkUserType } from '../map/walkSafety'

type GeolocationSample = Coordinates & { accuracy: number; speed: number | null; heading: number | null }
type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener: (event: 'release', callback: () => void) => void }
type DetourStep = { lat: number; lng: number; instruction: string }
type VerifiedDetour = { hazardId: string; source: string; wheelchairAccessible: boolean; steps: DetourStep[] }
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
const simulationRadius = 30

// No source-verified pedestrian route network is bundled with this app yet.
const verifiedDetours: VerifiedDetour[] = []

function bearingDegrees(from: Coordinates, to: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const lat1 = radians(from.lat)
  const lat2 = radians(to.lat)
  const longitude = radians(to.lng - from.lng)
  const y = Math.sin(longitude) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function offsetMeters(point: Coordinates, east: number, north = 0): Coordinates {
  return {
    lat: point.lat + north / 111320,
    lng: point.lng + east / (111320 * Math.cos(point.lat * Math.PI / 180)),
  }
}

function directionDifference(first: number, second: number) {
  return Math.abs(((first - second + 540) % 360) - 180)
}

export function WalkModePanel({
  active, moving, onMovingChange, userType, voiceRate, warningRadius, testMode, testLocation,
  onTestLocationChange, onLocationUpdate, onReportHazard, onAlreadyFixed, onLater, onToast,
}: Props) {
  const [wakeLockUnavailable, setWakeLockUnavailable] = useState(false)
  const [positionInaccurate, setPositionInaccurate] = useState(false)
  const [warning, setWarning] = useState<{ hazard: Hazard; message: string } | null>(null)
  const [questionHazard, setQuestionHazard] = useState<Hazard | null>(null)
  const [gpsLabel, setGpsLabel] = useState('현재 위치 확인 대기')
  const [locationIssue, setLocationIssue] = useState('')
  const [speechState, setSpeechState] = useState<'idle' | 'starting' | 'playing' | 'ready' | 'blocked'>('idle')
  const [speechIssue, setSpeechIssue] = useState('')
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState('')
  const [spokenUntil, setSpokenUntil] = useState(0)
  const [simulationActive, setSimulationActive] = useState(false)
  const [simulationRoute, setSimulationRoute] = useState(true)
  const [simulationDistance, setSimulationDistance] = useState(60)
  const [simulationResult, setSimulationResult] = useState('모의 보행 테스트를 시작하면 60m 위치에서 대기합니다.')
  const [simulationWarningCount, setSimulationWarningCount] = useState(0)
  const watchIdRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const activeHazardsRef = useRef<Hazard[]>([])
  const lastLoadLocationRef = useRef<Coordinates | null>(null)
  const lastPositionRef = useRef<{ coordinates: Coordinates; time: number } | null>(null)
  const lastSpeedRef = useRef<number>(1)
  const alertedHazardsRef = useRef<Map<string, Hazard>>(new Map())
  const passedQueueRef = useRef<Hazard[]>([])
  const questionRef = useRef<Hazard | null>(null)
  const stationaryTimerRef = useRef<number | null>(null)
  const stationarySinceRef = useRef<number | null>(null)
  const movingRef = useRef(moving)
  const appPausedRef = useRef(false)
  const simulationActiveRef = useRef(false)
  const simulationRouteRef = useRef(true)
  const simulationHazardRef = useRef<Hazard | null>(null)
  const speechAttemptRef = useRef(0)
  const speechStartedAttemptRef = useRef(0)
  const speechEndedAttemptRef = useRef(0)
  const speechBoundarySeenRef = useRef(false)
  const speechProgressTimerRef = useRef<number | null>(null)
  const koreanVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const processPositionRef = useRef<(sample: GeolocationSample) => void>(() => {})
  const answerQuestionRef = useRef<(answer: 'yes' | 'fixed' | 'later') => void>(() => {})

  movingRef.current = moving
  simulationActiveRef.current = simulationActive
  simulationRouteRef.current = simulationRoute

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const loadKoreanVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      koreanVoiceRef.current = voices.find((voice) => /^ko([-_]|$)/i.test(voice.lang)) ?? null
    }
    loadKoreanVoice()
    window.speechSynthesis.addEventListener('voiceschanged', loadKoreanVoice)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadKoreanVoice)
  }, [])

  function speak(text: string) {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    if (!synthesis || typeof synthesis.speak !== 'function' || typeof SpeechSynthesisUtterance === 'undefined') {
      setSpeechState('blocked')
      setSpeechIssue('현재 열린 앱 내 브라우저에서 음성 합성을 사용할 수 없습니다. 링크를 Chrome 또는 삼성 인터넷에서 직접 여세요. 삼성폰은 설정 > 일반 관리 > 글자 읽어주기에서 음성 엔진을 선택하고 한국어 음성을 설치해 주세요.')
      setScreenReaderAnnouncement(text)
      return
    }
    const attempt = ++speechAttemptRef.current
    if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
    speechProgressTimerRef.current = null
    speechBoundarySeenRef.current = false
    synthesis.cancel()
    synthesis.resume()
    setSpeechState('starting')
    setSpeechIssue('')
    setScreenReaderAnnouncement('')
    setSpokenUntil(0)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ko-KR'
    utterance.rate = voiceRate
    utterance.volume = 1
    const koreanVoice = synthesis.getVoices().find((voice) => /^ko([-_]|$)/i.test(voice.lang)) ?? koreanVoiceRef.current
    if (koreanVoice) utterance.voice = koreanVoice
    utterance.onstart = () => {
      speechStartedAttemptRef.current = attempt
      speechEndedAttemptRef.current = 0
      if (speechAttemptRef.current === attempt) setSpeechState('playing')
      window.setTimeout(() => {
        if (speechAttemptRef.current !== attempt || speechBoundarySeenRef.current || speechEndedAttemptRef.current === attempt) return
        const words = [...text.matchAll(/\S+/gu)]
        if (!words.length) return
        const wordDuration = Math.max(180, text.length * 115 / (words.length * voiceRate))
        let currentWord = 0
        speechProgressTimerRef.current = window.setInterval(() => {
          if (speechAttemptRef.current !== attempt || speechBoundarySeenRef.current) {
            if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
            speechProgressTimerRef.current = null
            return
          }
          currentWord = Math.min(words.length, currentWord + 1)
          const word = words[currentWord - 1]
          setSpokenUntil((word.index ?? 0) + word[0].length)
          if (currentWord === words.length && speechProgressTimerRef.current !== null) {
            window.clearInterval(speechProgressTimerRef.current)
            speechProgressTimerRef.current = null
          }
        }, wordDuration)
      }, 800)
    }
    utterance.onboundary = (event) => {
      if (speechAttemptRef.current !== attempt) return
      speechBoundarySeenRef.current = true
      if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
      const start = Math.max(0, event.charIndex)
      const wordEnd = text.slice(start).search(/\s/u)
      setSpokenUntil(wordEnd < 0 ? text.length : start + wordEnd + 1)
    }
    utterance.onend = () => {
      speechEndedAttemptRef.current = attempt
      if (speechAttemptRef.current === attempt) {
        setSpokenUntil(text.length)
        setSpeechState('ready')
      }
      if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
    }
    utterance.onerror = (event) => {
      if (speechAttemptRef.current !== attempt || event.error === 'canceled' || event.error === 'interrupted') return
      setSpeechState('blocked')
      if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
      const engineHelp = /Android/i.test(navigator.userAgent)
        ? '삼성폰: 설정 > 일반 관리 > 글자 읽어주기에서 기본 엔진을 Samsung TTS 또는 Speech Services by Google로 선택하고, 한국어 음성 데이터를 설치한 뒤 미디어 음량을 확인해 주세요.'
        : '기기의 음성 엔진과 미디어 음량을 확인한 뒤 다시 시도해 주세요.'
      setSpeechIssue(`음성 엔진 오류(${event.error}). ${engineHelp}`)
      setScreenReaderAnnouncement(text)
    }
    try {
      synthesis.speak(utterance)
    } catch {
      if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
      setSpeechState('blocked')
      setSpeechIssue('브라우저가 음성 재생을 막았어요. [소리 다시 확인]을 눌러 주세요.')
      return
    }
    window.setTimeout(() => {
      if (speechAttemptRef.current === attempt && speechStartedAttemptRef.current !== attempt) {
        setSpeechState('blocked')
        setSpeechIssue('음성이 시작되지 않았어요. [소리 다시 확인]을 눌러 주세요.')
        setScreenReaderAnnouncement(text)
      }
    }, 3500)
  }

  function unlockAudioFromGesture() {
    try {
      audioContextRef.current ??= new AudioContext()
      void audioContextRef.current.resume()
    } catch {
      // Speech output can still work when Web Audio is unavailable.
    }
  }

  function playWarningSound() {
    try {
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      void context.resume()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.15)
    } catch {
      // Speech remains the primary warning when Web Audio is unavailable.
    }
  }

  function findDetour(hazard: Hazard): VerifiedDetour | null {
    if (simulationActiveRef.current && simulationRouteRef.current) {
      return {
        hazardId: hazard.id,
        source: '테스트 전용 가상 우회로',
        wheelchairAccessible: true,
        steps: [{ ...offsetMeters(hazard, -12, 8), instruction: '앞 갈림길에서 오른쪽 보도를 따라가세요.' }],
      }
    }
    return verifiedDetours.find((route) => route.hazardId === hazard.id && (userType !== '휠체어' || route.wheelchairAccessible)) ?? null
  }

  function announceDetourStep(hazard: Hazard) {
    const route = findDetour(hazard)
    if (!route) {
      setSimulationResult('확인된 우회로가 없습니다. 실제 방향 안내는 제공하지 않았습니다.')
      return
    }
    const nextStep = route.steps[0]
    if (!nextStep) return
    speak(nextStep.instruction)
    setSimulationResult(`${route.source}: ${nextStep.instruction}`)
  }

  function showReportQuestion(hazard: Hazard) {
    if (questionRef.current || !movingRef.current) return
    questionRef.current = hazard
    setQuestionHazard(hazard)
    speak('방금 지나온 위험 구간이 아직 있었나요? 신고하시겠어요?')
    updateLatestAlertLog(hazard.id, { asked_to_report: true })
  }

  function maybeAskAfterStop(speed: number) {
    lastSpeedRef.current = speed
    if (speed > 0.5 || passedQueueRef.current.length === 0 || questionRef.current || appPausedRef.current) {
      stationarySinceRef.current = null
      if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
      stationaryTimerRef.current = null
      return
    }
    stationarySinceRef.current ??= Date.now()
    if (stationaryTimerRef.current !== null) return
    stationaryTimerRef.current = window.setTimeout(() => {
      stationaryTimerRef.current = null
      if (movingRef.current && lastSpeedRef.current <= 0.5 && passedQueueRef.current.length && !questionRef.current && !appPausedRef.current) {
        showReportQuestion(passedQueueRef.current[0])
      }
    }, Math.max(0, 5000 - (Date.now() - stationarySinceRef.current)))
  }

  function emitWarning(hazard: Hazard, sample: GeolocationSample, previous: { coordinates: Coordinates; time: number } | null, speed: number) {
    if (alertedHazardsRef.current.has(hazard.id)) return
    alertedHazardsRef.current.set(hazard.id, hazard)
    addAlertLog(hazard.id, userType)
    const distance = haversineMeters(sample, hazard)
    const accurate = sample.accuracy <= Math.min(20, activeWarningRadius() / 2)
    const trackBearing = previous && haversineMeters(previous.coordinates, sample) >= 3
      ? bearingDegrees(previous.coordinates, sample)
      : null
    const heading = speed > 0.7
      ? sample.heading !== null && sample.heading >= 0 ? sample.heading : trackBearing
      : null
    const inFront = accurate && heading !== null && directionDifference(heading, bearingDegrees(sample, hazard)) <= 55
    const detour = findDetour(hazard)
    const message = detour
      ? `앞쪽 보도에 ${hazard.type} 제보가 있습니다. 우회로를 안내합니다.`
      : `${hazardSpeech(hazard, userType, distance, { inFront, accurate })} 확인된 우회로가 없습니다.`
    setWarning({ hazard, message })
    playWarningSound()
    speak(message)
    if ('vibrate' in navigator) navigator.vibrate([180, 100, 180])
    if (simulationActiveRef.current) {
      setSimulationWarningCount((count) => count + 1)
      setSimulationResult(`경고 ${Math.round(distance)}m 지점에서 1회 발생${detour ? ' · 테스트 우회로 사용 가능' : ' · 확인된 우회로 없음'}`)
    }
  }

  function activeWarningRadius() {
    return simulationActiveRef.current ? simulationRadius : warningRadius || defaultWarningRadii[userType]
  }

  processPositionRef.current = (sample) => {
    if (appPausedRef.current || document.visibilityState !== 'visible') return
    const current = { lat: sample.lat, lng: sample.lng }
    const previous = lastPositionRef.current
    const timestamp = Date.now()
    const moved = previous ? haversineMeters(previous.coordinates, current) : 0
    const speed = sample.speed ?? (previous ? moved / Math.max(0.1, (timestamp - previous.time) / 1000) : 0)
    lastPositionRef.current = { coordinates: current, time: timestamp }
    setPositionInaccurate(sample.accuracy > 25)
    setGpsLabel(sample.accuracy > 25
      ? `위치 오차가 큽니다 · 약 ${Math.round(sample.accuracy)}m, 거리·방향을 단정하지 않아요`
      : `위치 정확도 약 ${Math.max(1, Math.round(sample.accuracy))}m`)
    setLocationIssue('')
    onLocationUpdate({ ...current, accuracy: sample.accuracy })
    maybeAskAfterStop(speed)

    if (!lastLoadLocationRef.current || haversineMeters(lastLoadLocationRef.current, current) >= 100) {
      activeHazardsRef.current = readHazards().filter((hazard) =>
        (simulationActiveRef.current || !hazard.id.startsWith('demo-'))
          && hazard.status !== 'fixed'
          && hazard.status !== '처리완료'
          && haversineMeters(current, hazard) <= 1200,
      )
      lastLoadLocationRef.current = current
    }

    const candidates = new Map(activeHazardsRef.current.map((hazard) => [hazard.id, hazard]))
    alertedHazardsRef.current.forEach((hazard, id) => candidates.set(id, hazard))
    candidates.forEach((hazard) => {
      if (!isHazardRelevant(hazard, userType)) return
      const distance = haversineMeters(current, hazard)
      const radius = activeWarningRadius()
      if (distance <= radius) {
        if (!alertedHazardsRef.current.has(hazard.id)) emitWarning(hazard, sample, previous, speed)
      } else if (distance > radius + Math.max(25, sample.accuracy + 20) && alertedHazardsRef.current.has(hazard.id)) {
        alertedHazardsRef.current.delete(hazard.id)
        if (!passedQueueRef.current.some((item) => item.id === hazard.id)) passedQueueRef.current.push(hazard)
        maybeAskAfterStop(speed)
      }
    })
  }

  function clearWatch() {
    if (watchIdRef.current !== null) navigator.geolocation?.clearWatch(watchIdRef.current)
    watchIdRef.current = null
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      void wakeLockRef.current.release()
      wakeLockRef.current = null
    }
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

  function resetSessionState() {
    if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
    stationaryTimerRef.current = null
    stationarySinceRef.current = null
    passedQueueRef.current = []
    questionRef.current = null
    alertedHazardsRef.current = new Map()
    lastLoadLocationRef.current = null
    lastPositionRef.current = null
    setWarning(null)
    setQuestionHazard(null)
    setLocationIssue('')
    appPausedRef.current = false
  }

  function beginWalk(simulation: boolean) {
    if (movingRef.current) return
    resetSessionState()
    setSimulationActive(simulation)
    simulationActiveRef.current = simulation
    setSimulationWarningCount(0)
    setSpeechState('idle')
    setGpsLabel(simulation ? '모의 위치 · 대전시청 시범 지점' : '위치 권한 확인 중')
    unlockAudioFromGesture()
    movingRef.current = true
    onMovingChange(true)
    speak('음성 안내를 켰습니다. 현재 위치를 확인합니다.')
    void keepScreenAwake()

    if (simulation) {
      const hazard = readHazards().find((item) => item.id === 'demo-root') ?? readHazards()[0]
      if (!hazard) {
        setLocationIssue('모의 테스트용 위험 지점이 없습니다.')
        stopWalk()
        return
      }
      simulationHazardRef.current = hazard
      setSimulationDistance(60)
      const start = offsetMeters(hazard, 60)
      onTestLocationChange(start)
      processPositionRef.current({ ...start, accuracy: 5, speed: 1, heading: 270 })
      return
    }

    setSimulationActive(false)
    simulationActiveRef.current = false
    if (testMode) {
      const origin = testLocation ?? cityHall
      const nearest = readHazards()
        .filter((hazard) => isHazardRelevant(hazard, userType) && hazard.status !== 'fixed' && hazard.status !== '처리완료')
        .map((hazard) => ({ hazard, distance: haversineMeters(origin, hazard) }))
        .filter(({ distance }) => distance <= 1200)
        .sort((first, second) => first.distance - second.distance)[0]?.hazard
      const start = nearest ? offsetMeters(nearest, 30) : origin
      onTestLocationChange(start)
      processPositionRef.current({ ...start, accuracy: 5, speed: 0, heading: 270 })
      return
    }

    if (!navigator.geolocation) {
      const message = '이 기기에서 위치 기능을 사용할 수 없습니다. 브라우저 위치 지원을 확인해 주세요.'
      setLocationIssue(message)
      setScreenReaderAnnouncement(message)
      setGpsLabel('위치 기능을 사용할 수 없음')
      stopWalk(true)
      return
    }
    clearWatch()
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const wasPaused = appPausedRef.current
        appPausedRef.current = false
        if (wasPaused) speak('위치를 다시 확인했습니다. 보행 안내를 재개합니다.')
        processPositionRef.current({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          speed: coords.speed,
          heading: coords.heading,
        })
      },
      (error) => {
        const message = error.code === 1
          ? '위치 권한이 거부됐어요. 브라우저 사이트 설정에서 위치를 허용한 뒤 다시 시작해 주세요.'
          : error.code === 3
            ? '위치 확인 시간이 초과됐어요. GPS가 잘 잡히는 곳에서 다시 시도해 주세요.'
            : '현재 위치를 확인할 수 없어요. 기기 위치 서비스와 브라우저 권한을 확인해 주세요.'
        setLocationIssue(message)
        setScreenReaderAnnouncement(message)
        setGpsLabel('위치 확인 실패')
        onToast(message)
        stopWalk(true)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  function startWalk() {
    beginWalk(false)
  }

  function startSimulation() {
    beginWalk(true)
  }

  function stopWalk(preserveSpeech = false) {
    movingRef.current = false
    onMovingChange(false)
    clearWatch()
    releaseWakeLock()
    if (!preserveSpeech) {
      ++speechAttemptRef.current
      window.speechSynthesis?.cancel()
      if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
    }
    if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
    stationaryTimerRef.current = null
    stationarySinceRef.current = null
    appPausedRef.current = false
    setSimulationActive(false)
    simulationActiveRef.current = false
    if (!preserveSpeech) setSpeechState('idle')
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

  answerQuestionRef.current = answerQuestion

  function moveSimulationToDistance(distance: number) {
    const hazard = simulationHazardRef.current
    if (!hazard) return
    const from = offsetMeters(hazard, distance)
    setSimulationDistance(distance)
    onTestLocationChange(from)
    processPositionRef.current({ ...from, accuracy: 5, speed: distance === 23 ? 0.4 : 1, heading: 270 })
    if (distance === 23 && simulationWarningCount > 0) {
      setSimulationResult('25m에서 1회 경고했고, 23m GPS 갱신에서는 같은 경고를 반복하지 않았습니다.')
    }
  }

  function moveSimulationToPastHazard() {
    const hazard = simulationHazardRef.current
    if (!hazard) return
    const past = offsetMeters(hazard, -60)
    setSimulationDistance(-60)
    onTestLocationChange(past)
    processPositionRef.current({ ...past, accuracy: 5, speed: 1, heading: 270 })
    setSimulationResult('위험 지점을 지난 상태입니다. 멈춘 뒤 5초가 지나면 신고 여부를 한 번 물어요.')
  }

  function simulateStationary() {
    const hazard = simulationHazardRef.current
    if (!hazard) return
    const stopped = offsetMeters(hazard, -60)
    processPositionRef.current({ ...stopped, accuracy: 5, speed: 0, heading: 270 })
    setSimulationResult('정지 감지 중 · 5초 후 신고 질문이 한 번 나타납니다.')
  }

  function simulateBranch() {
    const hazard = simulationHazardRef.current
    if (!hazard) return
    const branch = offsetMeters(hazard, 15)
    onTestLocationChange(branch)
    processPositionRef.current({ ...branch, accuracy: 5, speed: 0.8, heading: 270 })
    if (simulationRouteRef.current) announceDetourStep(hazard)
    else {
      const message = '이 근처에 위험 제보가 있습니다. 확인된 우회로가 없습니다.'
      setWarning({ hazard, message })
      speak(message)
      setSimulationResult('우회로 없음 시나리오: 임의 방향을 말하지 않고 경고합니다.')
    }
  }

  function retrySound() {
    unlockAudioFromGesture()
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.resume()
      koreanVoiceRef.current = window.speechSynthesis.getVoices().find((voice) => /^ko([-_]|$)/i.test(voice.lang)) ?? null
    }
    speak('음성 안내를 켰습니다. 현재 위치를 확인합니다.')
  }

  useEffect(() => {
    if (!moving || !testMode || simulationActive) return
    const coordinates = testLocation ?? cityHall
    processPositionRef.current({ ...coordinates, accuracy: 5, speed: 1, heading: null })
  }, [moving, simulationActive, testLocation, testMode])

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
        answerQuestionRef.current('later')
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
    if (!moving) {
      clearWatch()
      releaseWakeLock()
      return
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        appPausedRef.current = true
        ++speechAttemptRef.current
        window.speechSynthesis?.cancel()
        if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
        speechProgressTimerRef.current = null
        setSpeechState('idle')
        setGpsLabel('앱 전환 또는 화면 잠금으로 일시 중지됨 · 복귀 후 위치 확인 중')
        if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
        stationaryTimerRef.current = null
        stationarySinceRef.current = null
        return
      }
      if (!movingRef.current || !appPausedRef.current) return
      void keepScreenAwake()
      if (simulationActiveRef.current || testMode) {
        appPausedRef.current = false
        const current = simulationActiveRef.current && simulationHazardRef.current
          ? offsetMeters(simulationHazardRef.current, simulationDistance)
          : testLocation ?? cityHall
        processPositionRef.current({ ...current, accuracy: 5, speed: 0, heading: null })
        return
      }
      if (!navigator.geolocation) return
      setGpsLabel('복귀 후 새 GPS 위치를 기다리고 있어요')
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const wasPaused = appPausedRef.current
          appPausedRef.current = false
          if (wasPaused) speak('위치를 다시 확인했습니다. 보행 안내를 재개합니다.')
          processPositionRef.current({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, speed: coords.speed, heading: coords.heading })
        },
        () => {
          setLocationIssue('앱으로 돌아왔지만 새 위치를 받지 못했어요. 위치 권한과 GPS를 확인해 주세요.')
          setGpsLabel('새 위치 확인 필요 · 안내 일시 중지')
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [moving, simulationDistance, testLocation, testMode, voiceRate, warningRadius, userType])

  useEffect(() => () => {
    clearWatch()
    releaseWakeLock()
    ++speechAttemptRef.current
    window.speechSynthesis?.cancel()
    if (speechProgressTimerRef.current !== null) window.clearInterval(speechProgressTimerRef.current)
    if (stationaryTimerRef.current !== null) window.clearTimeout(stationaryTimerRef.current)
  }, [])

  return <>
    <section className="walk-mode-panel" aria-labelledby="walk-mode-title">
      {!moving ? <div className="walk-start-view">
        <div className="walk-emblem"><Footprints size={29} /></div>
        <p className="eyebrow">위치 기반 음성 안내</p>
        <h1 id="walk-mode-title" tabIndex={-1}>주변 위험을<br />미리 알려드려요.</h1>
        <p className="walk-intro">보행 시작을 누르면 음성 안내가 먼저 켜지고 위치 권한을 확인해요.</p>
        <Button variant="primary" className="walk-start-button" aria-label="보행 시작" onClick={startWalk}>
          <Navigation size={27} fill="currentColor" /><span>보행 시작</span><small>주변 위험을 자동으로 안내해요</small>
        </Button>
        <div className="walk-sound-check" role="status" aria-live="polite">
          <span>{speechState === 'playing' ? '음성 안내 재생 중' : speechState === 'ready' ? '음성 안내 준비됨' : speechState === 'blocked' ? speechIssue : '음성 안내 상태 확인 대기'}</span>
          {speechState === 'blocked' && <Button variant="secondary" aria-label="소리 다시 확인" onClick={retrySound}><Volume2 size={18} />소리 다시 확인</Button>}
          {locationIssue && <p className="walk-location-error">{locationIssue}</p>}
        </div>
        <span className="walk-screen-reader-only" role="status" aria-live="assertive" aria-atomic="true">{screenReaderAnnouncement}</span>
        <label className="simulation-route-toggle"><input type="checkbox" checked={simulationRoute} onChange={(event) => setSimulationRoute(event.target.checked)} /><span>모의 테스트에 테스트 전용 가상 우회로 포함</span></label>
        <Button variant="secondary" className="wide-button" aria-label="모의 보행 테스트 시작" onClick={startSimulation}>모의 보행 테스트 · 알림 거리 30m</Button>
        <p className="walk-privacy"><ShieldAlert size={16} />위치와 이동 이력은 기기 안에서만 처리해요.</p>
      </div> : <div className="walk-live-view">
        <div className="walk-live-heading"><span className="live-dot" />{simulationActive ? '모의 보행 테스트 중' : '보행 안내 중'}</div>
        <div className={`walk-location-status ${positionInaccurate ? 'inaccurate' : ''}`} role="status" aria-live="polite"><MapPin size={19} /><span>{gpsLabel}</span></div>
        {locationIssue && <p className="walk-location-error" role="alert">{locationIssue}</p>}
        <span className="walk-screen-reader-only" role="status" aria-live="assertive" aria-atomic="true">{screenReaderAnnouncement}</span>
        {wakeLockUnavailable && <p className="wake-lock-help" role="status" aria-live="polite">화면 잠금이나 앱 전환 중에는 위치 갱신이 멈출 수 있어요. 앱으로 돌아오면 새 위치를 받은 뒤 안내를 재개합니다. 가능하면 화면을 켠 상태로 사용해 주세요.</p>}
        {speechState === 'blocked' && <div className="walk-sound-check" role="alert"><p>{speechIssue}</p><Button variant="secondary" aria-label="소리 다시 확인" onClick={retrySound}><Volume2 size={18} />소리 다시 확인</Button></div>}
        {warning ? <div className="walk-warning-card" role="region" aria-label="위험 경고">
          <span className="warning-icon"><AlertTriangle size={31} /></span>
          <p className="warning-hazard-name">{warning.hazard.type} 위험</p>
          <h2 className="walk-warning-message" aria-live="assertive" aria-atomic="true">{warning.message.split(/(\s+)/u).map((part, index, parts) => {
            const wordStart = parts.slice(0, index).join('').length
            const isWord = /\S/u.test(part)
            return <span key={`${index}-${part}`} className={isWord ? `walk-warning-word ${wordStart < spokenUntil ? 'is-spoken' : ''}` : undefined}>{part}</span>
          })}</h2>
          <button type="button" aria-label="경고 음성 다시 듣기" onClick={() => speak(warning.message)}><Volume2 size={19} />다시 듣기</button>
        </div> : <div className="walk-scanning"><span className="scan-rings"><Navigation size={30} /></span><strong>{positionInaccurate ? '위치 오차가 커서 거리를 단정하지 않아요' : '주변 위험을 확인하고 있어요.'}</strong><span>{simulationActive ? `모의 위치 ${simulationDistance}m · 알림 거리 ${simulationRadius}m` : '위치와 이동 이력은 이 기기에서만 처리해요'}</span></div>}
        {(simulationActive || (testMode && moving)) && <div className="walk-simulation-controls" role="group" aria-label="모의 보행 테스트 단계">
          <strong>모의 테스트 결과</strong><p role="status" aria-live="polite">{simulationResult}</p>
          {simulationActive && simulationDistance === 60 && <Button variant="secondary" aria-label="테스트 위치를 25미터로 이동" onClick={() => moveSimulationToDistance(25)}>60m → 25m 접근</Button>}
          {simulationActive && simulationDistance === 25 && <Button variant="secondary" aria-label="테스트 위치를 23미터로 이동" onClick={() => moveSimulationToDistance(23)}>25m → 23m 접근</Button>}
          {simulationActive && simulationWarningCount > 0 && simulationRoute && <Button variant="secondary" aria-label="모의 갈림길에 도착해 우회 안내 듣기" onClick={simulateBranch}>모의 갈림길 안내 듣기</Button>}
          {simulationActive && simulationWarningCount > 0 && !simulationRoute && <Button variant="secondary" aria-label="우회로 없는 모의 갈림길 확인" onClick={simulateBranch}>우회로 없음 확인</Button>}
          {simulationActive && simulationWarningCount > 0 && simulationDistance >= 0 && <Button variant="secondary" aria-label="위험 지점을 지나간 것으로 모의 이동" onClick={moveSimulationToPastHazard}>위험 지점 지난 위치로 이동</Button>}
          {simulationActive && simulationDistance < 0 && !questionHazard && <Button variant="secondary" aria-label="모의 위치에서 멈춰 5초 대기" onClick={simulateStationary}>멈춘 상태 5초 확인</Button>}
        </div>}
        {testMode && !simulationActive && <div className="test-direction-pad" role="group" aria-label="테스트 위치를 10미터씩 이동">
          <Button variant="secondary" aria-label="테스트 위치를 북쪽으로 10미터 이동" onClick={() => moveManualTestLocation('north')}><ArrowUp size={19} />북쪽 10m</Button>
          <Button variant="secondary" aria-label="테스트 위치를 서쪽으로 10미터 이동" onClick={() => moveManualTestLocation('west')}><ArrowLeft size={19} />서쪽 10m</Button>
          <Button variant="secondary" aria-label="테스트 위치를 동쪽으로 10미터 이동" onClick={() => moveManualTestLocation('east')}><ArrowRight size={19} />동쪽 10m</Button>
          <Button variant="secondary" aria-label="테스트 위치를 남쪽으로 10미터 이동" onClick={() => moveManualTestLocation('south')}><ArrowDown size={19} />남쪽 10m</Button>
        </div>}
        <Button variant="secondary" className="walk-stop-button" aria-label="보행 종료" onClick={() => stopWalk()}><X size={19} />보행 종료</Button>
      </div>}
    </section>
    {questionHazard && <div className="walk-question-backdrop"><section className="walk-question-sheet" role="dialog" aria-modal="true" aria-labelledby="passed-question-title" aria-describedby="passed-question-description">
      <div className="sheet-grabber" aria-hidden="true" /><div className="question-symbol"><AlertTriangle size={26} /></div><p className="eyebrow">위험 구간 통과 · 멈춤 확인</p>
      <h2 id="passed-question-title" tabIndex={-1}>방금 지나온 위험 구간이 아직 있었나요?</h2>
      <p id="passed-question-description">{questionHazard.type} · {questionHazard.place || questionHazard.title}</p>
      <div className="question-actions">
        <Button variant="primary" aria-label="예, 신고할게요" onClick={() => answerQuestion('yes')}>예, 신고할게요<ArrowUp size={18} /></Button>
        <Button variant="secondary" aria-label="이미 고쳐졌어요" onClick={() => answerQuestion('fixed')}><Check size={18} />이미 고쳐졌어요</Button>
        <Button variant="secondary" aria-label="나중에 답하기" onClick={() => answerQuestion('later')}><X size={18} />나중에</Button>
      </div>
    </section></div>}
  </>

  function moveManualTestLocation(direction: 'north' | 'south' | 'east' | 'west') {
    const from = testLocation ?? cityHall
    const offset = direction === 'east' ? offsetMeters(from, 10) : direction === 'west' ? offsetMeters(from, -10) : direction === 'north' ? offsetMeters(from, 0, 10) : offsetMeters(from, 0, -10)
    onTestLocationChange(offset)
    processPositionRef.current({ ...offset, accuracy: 5, speed: 1, heading: null })
  }
}
