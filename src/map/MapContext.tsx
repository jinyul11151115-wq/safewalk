import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type Coordinates = { lat: number; lng: number; accuracy?: number }
export type MapStatus = 'loading' | 'ready' | 'error'
export type LocationPermission = 'prompt' | 'granted' | 'denied' | 'unsupported' | 'unknown'

type KakaoLatLng = { getLat: () => number; getLng: () => number }
type KakaoSdk = {
  maps: {
    load: (callback: () => void) => void
    LatLng: new (lat: number, lng: number) => KakaoLatLng
    LatLngBounds: new () => { extend: (position: KakaoLatLng) => void; contain: (position: KakaoLatLng) => boolean }
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoRawMap
    CustomOverlay: new (options: Record<string, unknown>) => {
      setMap: (map: KakaoRawMap | null) => void
      setPosition: (position: KakaoLatLng) => void
      setZIndex: (zIndex: number) => void
      getPosition: () => KakaoLatLng
      getContent: () => HTMLElement
    }
    event: {
      addListener: (target: object, event: string, callback: (value?: any) => void) => void
      removeListener: (target: object, event: string, callback: (value?: any) => void) => void
    }
  }
}

type KakaoRawMap = {
  setCenter: (position: KakaoLatLng) => void
  panTo: (position: KakaoLatLng) => void
  getCenter: () => KakaoLatLng
  getBounds: () => { contain: (position: KakaoLatLng) => boolean }
  getLevel: () => number
  setLevel: (level: number) => void
  setBounds: (bounds: unknown) => void
  relayout: () => void
  panBy: (x: number, y: number) => void
  getProjection: () => {
    containerPointFromCoords: (position: KakaoLatLng) => { getX: () => number; getY: () => number }
    coordsFromContainerPoint: (point: { x: number; y: number }) => KakaoLatLng
  }
}

declare global {
  interface Window { kakao?: KakaoSdk }
}

const MapContext = createContext<{
  map: KakaoMapAdapter | null
  mapStatus: MapStatus
  mapError: string
  mapHostRef: (element: HTMLDivElement | null) => void
  retryMap: () => void
  moveToMyLocation: () => Promise<Coordinates | null>
  updateCurrentLocation: (coordinates: Coordinates) => void
  currentLocation: Coordinates | null
  locationPermission: LocationPermission
  locationError: string
} | null>(null)

const cityHall: Coordinates = { lat: 36.3504, lng: 127.3845 }
let sdkLoadPromise: Promise<KakaoSdk> | null = null

function loadKakaoSdk() {
  if (window.kakao?.maps) return Promise.resolve(window.kakao)
  if (sdkLoadPromise) return sdkLoadPromise
  const key = import.meta.env.VITE_KAKAO_MAP_APP_KEY
  if (!key) return Promise.reject(new Error('카카오맵 JavaScript 키가 설정되지 않았습니다.'))

  sdkLoadPromise = new Promise<KakaoSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`
    script.async = true
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'))
        return
      }
      window.kakao.maps.load(() => resolve(window.kakao!))
    }
    script.onerror = () => reject(new Error('카카오맵 SDK 요청이 거부됐습니다. Kakao Developers에서 Kakao Map 서비스를 활성화하고 JavaScript 키와 웹 도메인을 확인해 주세요.'))
    document.head.append(script)
  }).catch((error) => {
    sdkLoadPromise = null
    throw error
  })
  return sdkLoadPromise
}

export class KakaoMapAdapter {
  readonly raw: KakaoRawMap
  readonly sdk: KakaoSdk
  private listeners = new Map<string, Map<(...args: any[]) => void, (...args: any[]) => void>>()

  constructor(sdk: KakaoSdk, raw: KakaoRawMap) {
    this.sdk = sdk
    this.raw = raw
  }

  getCenter() {
    const center = this.raw.getCenter()
    return { lat: center.getLat(), lng: center.getLng() }
  }

  getBounds() {
    const bounds = this.raw.getBounds()
    return { contains: (coordinates: [number, number]) => bounds.contain(new this.sdk.maps.LatLng(coordinates[1], coordinates[0])) }
  }

  on(event: 'moveend' | 'idle' | 'click', callback: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? new Map()
    if (listeners.has(callback)) return
    const sdkEvent = event === 'click' ? 'click' : 'idle'
    const wrapped = (value?: any) => {
      if (event === 'click' && value?.latLng) {
        const position = value.latLng as KakaoLatLng
        callback({ lngLat: { lat: position.getLat(), lng: position.getLng() } })
      } else callback(value)
    }
    listeners.set(callback, wrapped)
    this.listeners.set(event, listeners)
    this.sdk.maps.event.addListener(this.raw, sdkEvent, wrapped)
  }

  off(event: 'moveend' | 'idle' | 'click', callback: (...args: any[]) => void) {
    const listeners = this.listeners.get(event)
    const wrapped = listeners?.get(callback)
    if (!wrapped) return
    this.sdk.maps.event.removeListener(this.raw, event === 'click' ? 'click' : 'idle', wrapped)
    listeners?.delete(callback)
  }

  easeTo(options: { center: [number, number] | { lat: number; lng: number }; duration?: number; offset?: [number, number] }) {
    const center = Array.isArray(options.center)
      ? new this.sdk.maps.LatLng(options.center[1], options.center[0])
      : new this.sdk.maps.LatLng(options.center.lat, options.center.lng)
    this.raw.panTo(center)
    if (options.offset) window.setTimeout(() => this.raw.panBy(options.offset![0], options.offset![1]), 0)
  }

  resize() { this.raw.relayout() }
  zoomIn() { this.raw.setLevel(Math.max(1, this.raw.getLevel() - 1)) }
  zoomOut() { this.raw.setLevel(Math.min(14, this.raw.getLevel() + 1)) }
  destroy() {
    this.listeners.forEach((listeners, event) => listeners.forEach((wrapped) => {
      this.sdk.maps.event.removeListener(this.raw, event === 'click' ? 'click' : 'idle', wrapped)
    }))
    this.listeners.clear()
  }
}

export class KakaoMarker {
  private overlay: InstanceType<KakaoSdk['maps']['CustomOverlay']>
  private map: KakaoMapAdapter | null = null
  private listeners = new Map<string, Set<(...args: any[]) => void>>()
  private dragCleanup: (() => void) | null = null

  constructor(options: { element: HTMLElement; anchor?: 'bottom'; draggable?: boolean; raiseOnHover?: boolean }) {
    this.element = options.element
    this.draggable = Boolean(options.draggable)
    this.element.style.cursor = this.draggable ? 'grab' : 'pointer'
    this.overlay = null as unknown as InstanceType<KakaoSdk['maps']['CustomOverlay']>
    this.position = { lat: cityHall.lat, lng: cityHall.lng }
    this.ready = loadKakaoSdk().then((sdk) => {
      this.sdk = sdk
      this.overlay = new sdk.maps.CustomOverlay({
        content: this.element,
        position: new sdk.maps.LatLng(this.position.lat, this.position.lng),
        xAnchor: 0.5,
        yAnchor: options.anchor === 'bottom' ? 1 : 0.5,
        zIndex: 5,
        clickable: true,
      })
      if (options.raiseOnHover) {
        this.element.addEventListener('pointerenter', () => this.overlay.setZIndex(50))
        this.element.addEventListener('pointerleave', () => this.overlay.setZIndex(5))
      }
      if (this.map) this.overlay.setMap(this.map.raw)
      if (this.draggable) this.enableDragging()
    })
  }

  private element: HTMLElement
  private draggable: boolean
  private position: Coordinates
  private sdk!: KakaoSdk
  private ready: Promise<void>

  setLngLat(coordinates: [number, number]) {
    this.position = { lng: coordinates[0], lat: coordinates[1] }
    void this.ready.then(() => this.overlay.setPosition(new this.sdk.maps.LatLng(this.position.lat, this.position.lng)))
    return this
  }

  addTo(map: KakaoMapAdapter) {
    this.map = map
    void this.ready.then(() => this.overlay.setMap(map.raw))
    return this
  }

  remove() {
    this.map = null
    this.dragCleanup?.()
    this.dragCleanup = null
    void this.ready.then(() => this.overlay.setMap(null))
  }

  getElement() { return this.element }

  getLngLat() {
    if (this.overlay && this.map) {
      const position = this.overlay.getPosition()
      return { lat: position.getLat(), lng: position.getLng() }
    }
    return this.position
  }

  on(event: 'dragend', callback: () => void) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(callback)
    this.listeners.set(event, set)
  }

  private enableDragging() {
    if (!this.map) return
    let pointerId: number | null = null
    const down = (event: PointerEvent) => {
      if (!this.map || (event.pointerType === 'mouse' && event.button !== 0)) return
      pointerId = event.pointerId
      event.preventDefault()
      event.stopPropagation()
      this.element.setPointerCapture?.(pointerId)
      this.element.style.cursor = 'grabbing'
    }
    const move = (event: PointerEvent) => {
      if (!this.map || pointerId !== event.pointerId) return
      event.preventDefault()
      const rect = this.map.raw.getProjection().containerPointFromCoords(new this.sdk.maps.LatLng(this.position.lat, this.position.lng))
      const startX = rect.getX()
      const startY = rect.getY()
      const target = this.map.raw.getProjection().coordsFromContainerPoint({ x: startX + event.movementX, y: startY + event.movementY })
      this.setLngLat([target.getLng(), target.getLat()])
    }
    const up = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return
      pointerId = null
      this.element.style.cursor = 'grab'
      this.listeners.get('dragend')?.forEach((callback) => callback())
    }
    this.element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    this.dragCleanup = () => {
      this.element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }
}

export function MapProvider({ children }: { children: ReactNode }) {
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading')
  const [mapError, setMapError] = useState('')
  const [map, setMap] = useState<KakaoMapAdapter | null>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null)
  const [locationPermission, setLocationPermission] = useState<LocationPermission>(() => navigator.geolocation ? 'prompt' : 'unsupported')
  const [locationError, setLocationError] = useState('')
  const mapRef = useRef<KakaoMapAdapter | null>(null)
  const locationMarkerRef = useRef<KakaoMarker | null>(null)

  const mapHostRef = useCallback((element: HTMLDivElement | null) => setHost(element), [])
  const updateCurrentLocation = useCallback((coordinates: Coordinates) => setCurrentLocation(coordinates), [])
  const retryMap = useCallback(() => setRetryCount((count) => count + 1), [])

  useEffect(() => {
    if (!host) return
    let active = true
    let adapter: KakaoMapAdapter | null = null
    setMapStatus('loading')
    setMapError('')
    mapRef.current = null

    void loadKakaoSdk().then((sdk) => {
      if (!active) return
      host.replaceChildren()
      const center = currentLocation ?? cityHall
      const raw = new sdk.maps.Map(host, {
        center: new sdk.maps.LatLng(center.lat, center.lng),
        level: 4,
      })
      adapter = new KakaoMapAdapter(sdk, raw)
      mapRef.current = adapter
      setMap(adapter)
      setMapStatus('ready')
      window.setTimeout(() => adapter?.resize(), 100)
    }).catch((error: unknown) => {
      if (active) {
        setMapError(error instanceof Error ? error.message : '카카오맵을 불러오지 못했습니다. 서비스와 도메인 설정을 확인해 주세요.')
        setMapStatus('error')
      }
    })

    return () => {
      active = false
      adapter?.destroy()
      if (mapRef.current === adapter) mapRef.current = null
      locationMarkerRef.current?.remove()
      locationMarkerRef.current = null
      setMap(null)
    }
  }, [host, retryCount])

  useEffect(() => {
    if (!map || !currentLocation) return
    map.easeTo({ center: [currentLocation.lng, currentLocation.lat], duration: 350 })
    if (!locationMarkerRef.current) {
      const element = document.createElement('div')
      element.className = 'current-location-marker'
      element.setAttribute('role', 'img')
      element.setAttribute('aria-label', '현재 내 위치')
      locationMarkerRef.current = new KakaoMarker({ element })
    }
    locationMarkerRef.current.getElement().style.zIndex = '20'
    locationMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat]).addTo(map)
  }, [currentLocation, map])

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationPermission('unsupported')
      setLocationError('이 기기에서는 현재 위치를 사용할 수 없어요.')
      return
    }
    if (!navigator.permissions?.query) {
      setLocationPermission('prompt')
      return
    }
    let active = true
    let permissionStatus: PermissionStatus | null = null
    const onPermissionChange = () => { if (permissionStatus) setLocationPermission(permissionStatus.state as LocationPermission) }
    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((status) => {
      if (!active) return
      permissionStatus = status
      setLocationPermission(status.state as LocationPermission)
      status.addEventListener('change', onPermissionChange)
      if (status.state === 'granted') navigator.geolocation.getCurrentPosition(
        ({ coords }) => setCurrentLocation({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
        () => {},
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
      )
    }).catch(() => setLocationPermission('prompt'))
    return () => {
      active = false
      permissionStatus?.removeEventListener('change', onPermissionChange)
    }
  }, [])

  const moveToMyLocation = useCallback(() => new Promise<Coordinates | null>((resolve) => {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationPermission('unsupported')
      setLocationError('이 기기에서는 현재 위치를 사용할 수 없어요.')
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const position = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }
      setCurrentLocation(position)
      setLocationPermission('granted')
      setLocationError('')
      resolve(position)
    }, (error) => {
      setLocationPermission(error.code === 1 ? 'denied' : locationPermission)
      setLocationError(error.code === 1
        ? '위치 권한이 차단되어 있어요. 브라우저의 사이트 설정에서 위치를 허용해 주세요.'
        : error.code === 3
          ? '위치를 확인하는 데 시간이 오래 걸려요. 다시 시도해 주세요.'
          : '현재 위치를 확인하지 못했어요. GPS 신호를 확인해 주세요.')
      resolve(null)
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 })
  }), [locationPermission])

  return <MapContext.Provider value={{ map, mapStatus, mapError, mapHostRef, retryMap, moveToMyLocation, updateCurrentLocation, currentLocation, locationPermission, locationError }}>{children}</MapContext.Provider>
}

export function useMapContext() {
  const value = useContext(MapContext)
  if (!value) throw new Error('useMapContext must be used inside MapProvider')
  return value
}
