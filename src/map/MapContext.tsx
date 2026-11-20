import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorkerUrl)

export type Coordinates = { lat: number; lng: number; accuracy?: number }
export type MapStatus = 'loading' | 'ready' | 'error'
export type LocationPermission = 'prompt' | 'granted' | 'denied' | 'unsupported' | 'unknown'

type MapContextValue = {
  map: MapLibreMap | null
  mapStatus: MapStatus
  mapHostRef: (element: HTMLDivElement | null) => void
  retryMap: () => void
  moveToMyLocation: () => Promise<Coordinates | null>
  updateCurrentLocation: (coordinates: Coordinates) => void
  currentLocation: Coordinates | null
  locationPermission: LocationPermission
  locationError: string
}

const MapContext = createContext<MapContextValue | null>(null)
const cityHall: Coordinates = { lat: 36.3504, lng: 127.3845 }
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export function MapProvider({ children }: { children: ReactNode }) {
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading')
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null)
  const [locationPermission, setLocationPermission] = useState<LocationPermission>(() => navigator.geolocation ? 'prompt' : 'unsupported')
  const [locationError, setLocationError] = useState('')
  const mapRef = useRef<MapLibreMap | null>(null)
  const locationMarkerRef = useRef<Marker | null>(null)
  const mapLoadedRef = useRef(false)
  const loadTimerRef = useRef<number | null>(null)

  const mapHostRef = useCallback((element: HTMLDivElement | null) => setHost(element), [])
  const updateCurrentLocation = useCallback((coordinates: Coordinates) => setCurrentLocation(coordinates), [])
  const retryMap = useCallback(() => {
    const instance = mapRef.current
    if (!instance) {
      setRetryCount((count) => count + 1)
      return
    }
    mapLoadedRef.current = false
    setMapStatus('loading')
    if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current)
    loadTimerRef.current = window.setTimeout(() => {
      if (!mapLoadedRef.current) setMapStatus('error')
    }, 15000)
    instance.once('style.load', () => {
      mapLoadedRef.current = true
      if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current)
      setMapStatus('ready')
    })
    instance.setStyle(OPENFREEMAP_STYLE_URL)
  }, [])

  useEffect(() => {
    if (!host || mapRef.current) return
    mapLoadedRef.current = false
    setMapStatus('loading')
    const center = currentLocation ?? cityHall
    let instance: MapLibreMap
    try {
      instance = new MapLibreMap({
        container: host,
        style: OPENFREEMAP_STYLE_URL,
        center: [center.lng, center.lat],
        zoom: 14,
        attributionControl: { compact: false },
      })
    } catch {
      setMapStatus('error')
      return
    }
    mapRef.current = instance
    instance.on('load', () => {
      mapLoadedRef.current = true
      if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current)
      setMapStatus('ready')
      setMap(instance)
    })
    instance.on('error', () => {
      if (!mapLoadedRef.current) {
        if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current)
        setMapStatus('error')
      }
    })
    loadTimerRef.current = window.setTimeout(() => {
      if (!mapLoadedRef.current) setMapStatus('error')
    }, 15000)
    setMap(instance)
  }, [currentLocation, host, retryCount])

  useEffect(() => {
    if (!map || !currentLocation) return
    map.easeTo({ center: [currentLocation.lng, currentLocation.lat], duration: 350 })
    if (!locationMarkerRef.current) {
      const element = document.createElement('div')
      element.className = 'current-location-marker'
      element.setAttribute('role', 'img')
      element.setAttribute('aria-label', '현재 내 위치')
      locationMarkerRef.current = new Marker({ element }).setLngLat([currentLocation.lng, currentLocation.lat])
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
    const onPermissionChange = () => {
      if (permissionStatus) setLocationPermission(permissionStatus.state as LocationPermission)
    }
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!active) return
        permissionStatus = status
        setLocationPermission(status.state as LocationPermission)
        status.addEventListener('change', onPermissionChange)
        if (status.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => setCurrentLocation({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
            () => {},
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
          )
        }
      })
      .catch(() => setLocationPermission('prompt'))
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
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }
        setCurrentLocation(position)
        setLocationPermission('granted')
        setLocationError('')
        resolve(position)
      },
      (error) => {
        setLocationPermission(error.code === 1 ? 'denied' : locationPermission)
        setLocationError(error.code === 1
          ? '위치 권한이 차단되어 있어요. 브라우저의 사이트 설정에서 위치를 허용해 주세요.'
          : error.code === 3
            ? '위치를 확인하는 데 시간이 오래 걸려요. 다시 시도해 주세요.'
            : '현재 위치를 확인하지 못했어요. GPS 신호를 확인해 주세요.')
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
    )
  }), [locationPermission])

  return (
    <MapContext.Provider value={{ map, mapStatus, mapHostRef, retryMap, moveToMyLocation, updateCurrentLocation, currentLocation, locationPermission, locationError }}>
      {children}
    </MapContext.Provider>
  )
}

export function useMapContext() {
  const value = useContext(MapContext)
  if (!value) throw new Error('useMapContext must be used inside MapProvider')
  return value
}
