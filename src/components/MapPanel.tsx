import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, ChevronUp, Crosshair, Filter, Info, List, LocateFixed, Minus, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { KakaoMarker, useMapContext, type Coordinates } from '../map/MapContext'
import { hazardStatusLabel, hazardStatuses, hazardTypeGlyphs, hazardTypeLabels, hazardTypes, type Hazard, type HazardStatus, type HazardType } from '../map/hazards'
import { haversineMeters } from '../map/walkSafety'

type Props = {
  hazards: Hazard[]
  visibleIds: string[] | null
  typeFilter: HazardType | '전체 유형'
  statusFilter: HazardStatus | '전체 상태'
  onSelect: (hazard: Hazard) => void
  onTypeFilter: (filter: HazardType | '전체 유형') => void
  onStatusFilter: (filter: HazardStatus | '전체 상태') => void
  onVisibleIds: (ids: string[]) => void
  onAddHazard: () => void
  onLocationError: (message?: string) => void
  miniMode: boolean
  dragPinEnabled: boolean
  locationPickMode: boolean
  reportLocation: Coordinates | null
  onReportLocationChange: (coordinates: Coordinates) => void
  testMode: boolean
  testLocation: Coordinates | null
  onTestLocation: (coordinates: Coordinates) => void
  mapVisible: boolean
  walkMode: boolean
}

function isShown(hazard: Hazard, ids: string[] | null, typeFilter: Props['typeFilter'], statusFilter: Props['statusFilter']) {
  const displayStatus = hazardStatusLabel(hazard.status)
  return (ids === null || ids.includes(hazard.id))
    && (typeFilter === '전체 유형' || hazard.type === typeFilter)
    && (statusFilter === '전체 상태' || displayStatus === statusFilter)
}

export function MapPanel({
  hazards, visibleIds, typeFilter, statusFilter, onSelect,
  onTypeFilter, onStatusFilter, onVisibleIds, onAddHazard, onLocationError,
  miniMode, dragPinEnabled, locationPickMode, reportLocation, onReportLocationChange,
  testMode, testLocation, onTestLocation, mapVisible, walkMode,
}: Props) {
  const { map, mapStatus, mapError, mapHostRef, retryMap, moveToMyLocation, currentLocation, locationPermission, locationError } = useMapContext()
  const [screenReaderListOpen, setScreenReaderListOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(() => !window.matchMedia('(max-width: 850px)').matches)
  const suppressFilterClickUntilRef = useRef(0)
  const markerRefs = useRef<Map<string, KakaoMarker>>(new Map())
  const markerHazardsRef = useRef<Map<KakaoMarker, Hazard[]>>(new Map())
  const dragMarkerRef = useRef<KakaoMarker | null>(null)
  const testMarkerRef = useRef<KakaoMarker | null>(null)

  const mapCenter = (testMode && testLocation)
    ? testLocation
    : currentLocation ?? (map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : { lat: 36.3504, lng: 127.3845 })
  const listHazards = hazards
    .filter((hazard) => isShown(hazard, null, typeFilter, statusFilter))
    .sort((first, second) => haversineMeters(mapCenter, first) - haversineMeters(mapCenter, second))

  useEffect(() => {
    if (mapStatus !== 'ready' || !map) return
    const markers = new Map<string, KakaoMarker>()
    const grouped: Hazard[][] = []
    hazards.forEach((hazard) => {
      const group = grouped.find((items) => haversineMeters(items[0], hazard) <= 10)
      if (group) group.push(hazard)
      else grouped.push([hazard])
    })

    grouped.forEach((group) => {
      const makeHazardButton = (hazard: Hazard, primary: boolean) => {
        const displayStatus = hazardStatusLabel(hazard.status)
        const resolved = displayStatus === '처리완료'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `sdk-hazard status-${displayStatus === '미신고' ? 'new' : displayStatus === '신고됨' ? 'reported' : 'resolved'}${primary ? ' sdk-hazard-cluster-primary' : ''}`
        button.setAttribute('aria-label', `${hazard.type}, ${displayStatus}, ${hazard.title}`)
        const glyph = document.createElement('span')
        glyph.className = 'sdk-hazard-glyph'
        glyph.textContent = hazardTypeGlyphs[hazard.type]
        const label = document.createElement('span')
        label.className = 'sdk-hazard-label'
        label.textContent = hazardTypeLabels[hazard.type]
        const state = document.createElement('span')
        state.className = 'sdk-hazard-state'
        state.textContent = resolved ? '처리완료 ✓' : displayStatus
        button.append(glyph, label, state)
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          onSelect(hazard)
        })
        return button
      }

      const element = document.createElement('div')
      element.className = `sdk-hazard-cluster ${group.length > 1 ? 'has-overlap' : ''}`
      const primary = makeHazardButton(group[0], true)
      element.append(primary)
      if (group.length > 1) {
        const badge = document.createElement('span')
        badge.className = 'sdk-hazard-cluster-count'
        badge.textContent = String(group.length)
        badge.setAttribute('aria-hidden', 'true')
        primary.append(badge)

        const options = document.createElement('div')
        options.className = 'sdk-hazard-cluster-options'
        options.setAttribute('role', 'group')
        options.setAttribute('aria-label', `${group.length}개의 겹친 제보`)
        const heading = document.createElement('span')
        heading.className = 'sdk-hazard-cluster-heading'
        heading.textContent = `겹친 제보 ${group.length}건 · 항목을 선택하세요`
        options.append(heading)
        group.forEach((hazard) => options.append(makeHazardButton(hazard, false)))
        element.append(options)
        primary.addEventListener('click', (event) => {
          if (matchMedia('(hover: hover)').matches) return
          event.preventDefault()
          event.stopImmediatePropagation()
          element.classList.toggle('is-expanded')
        }, true)
      }

      const marker = new KakaoMarker({ element, anchor: 'bottom', raiseOnHover: group.length > 1 }).setLngLat([group[0].lng, group[0].lat])
      group.forEach((hazard) => markers.set(hazard.id, marker))
      markerHazardsRef.current.set(marker, group)
    })
    markerRefs.current = markers

    let debounceTimer = 0
    const queryVisibleHazards = () => {
      window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        const bounds = map.getBounds()
        const ids = hazards
          .filter((hazard) => bounds.contains([hazard.lng, hazard.lat]))
          .map((hazard) => hazard.id)
        onVisibleIds(ids)
      }, 500)
    }
    map.on('moveend', queryVisibleHazards)
    map.on('idle', queryVisibleHazards)
    queryVisibleHazards()

    return () => {
      window.clearTimeout(debounceTimer)
      map.off('moveend', queryVisibleHazards)
      map.off('idle', queryVisibleHazards)
      markers.forEach((marker) => marker.remove())
      markerRefs.current = new Map()
      markerHazardsRef.current = new Map()
    }
  }, [hazards, map, mapStatus, onSelect, onVisibleIds])

  useEffect(() => {
    if (!map) return
    const visited = new Set<KakaoMarker>()
    markerRefs.current.forEach((marker) => {
      if (visited.has(marker)) return
      visited.add(marker)
      const group = markerHazardsRef.current.get(marker) ?? []
      const shouldShow = !miniMode && group.some((hazard) => {
        const activeHazard = hazard.status !== 'fixed' && hazard.status !== '처리완료'
        return walkMode ? activeHazard : isShown(hazard, visibleIds, typeFilter, statusFilter)
      })
      if (shouldShow) {
        marker.addTo(map)
      } else marker.remove()
    })
  }, [hazards, map, miniMode, statusFilter, typeFilter, visibleIds, walkMode])

  useEffect(() => {
    if (!map || mapStatus !== 'ready' || !locationPickMode) return
    const coordinates = reportLocation ?? { lat: 36.3504, lng: 127.3845 }
    map.easeTo({ center: [coordinates.lng, coordinates.lat], duration: 300 })
    const updatePickedLocation = () => {
      const center = map.getCenter()
      onReportLocationChange({ lat: center.lat, lng: center.lng })
    }
    map.on('moveend', updatePickedLocation)
    return () => map.off('moveend', updatePickedLocation)
  }, [locationPickMode, map, mapStatus, onReportLocationChange])

  useEffect(() => {
    if (!map || mapStatus !== 'ready') return
    if (locationPickMode) {
      dragMarkerRef.current?.remove()
      dragMarkerRef.current = null
      return
    }
    if (!miniMode || !dragPinEnabled) {
      dragMarkerRef.current?.remove()
      dragMarkerRef.current = null
      return
    }
    const coordinates = reportLocation ?? { lat: 36.3504, lng: 127.3845 }
    if (!dragMarkerRef.current) {
      const element = document.createElement('div')
      element.className = 'report-pin'
      element.setAttribute('role', 'img')
      element.setAttribute('aria-label', '드래그해서 제보 위치를 보정할 수 있는 핀')
      dragMarkerRef.current = new KakaoMarker({ element, draggable: true })
        .setLngLat([coordinates.lng, coordinates.lat])
        .addTo(map)
      dragMarkerRef.current.on('dragend', () => {
        const position = dragMarkerRef.current?.getLngLat()
        if (position) onReportLocationChange({ lat: position.lat, lng: position.lng })
      })
    } else {
      dragMarkerRef.current.setLngLat([coordinates.lng, coordinates.lat])
    }
    dragMarkerRef.current.setLngLat([coordinates.lng, coordinates.lat])
    map.easeTo({ center: [coordinates.lng, coordinates.lat], duration: 400 })
  }, [dragPinEnabled, locationPickMode, map, mapStatus, miniMode, onReportLocationChange, reportLocation])

  useEffect(() => {
    if (!map || mapStatus !== 'ready' || !mapVisible) return
    const frames: number[] = []
    const timers: number[] = []
    const resizeMap = () => {
      map.resize()
    }
    frames.push(window.requestAnimationFrame(() => {
      resizeMap()
      frames.push(window.requestAnimationFrame(resizeMap))
    }))
    timers.push(window.setTimeout(resizeMap, 120), window.setTimeout(resizeMap, 360))
    return () => {
      frames.forEach(window.cancelAnimationFrame)
      timers.forEach(window.clearTimeout)
    }
  }, [locationPickMode, map, mapStatus, mapVisible, miniMode])

  useEffect(() => {
    if (!map || mapStatus !== 'ready' || !testMode) {
      testMarkerRef.current?.remove()
      testMarkerRef.current = null
      return
    }
    if (!testLocation) return
    if (!testMarkerRef.current) {
      const element = document.createElement('div')
      element.className = 'current-location-marker test-location-marker'
      element.setAttribute('role', 'img')
      element.setAttribute('aria-label', '테스트 내 위치')
      testMarkerRef.current = new KakaoMarker({ element })
        .setLngLat([testLocation.lng, testLocation.lat])
        .addTo(map)
    } else {
      testMarkerRef.current.setLngLat([testLocation.lng, testLocation.lat])
    }
    testMarkerRef.current.setLngLat([testLocation.lng, testLocation.lat])
  }, [map, mapStatus, testLocation, testMode])

  useEffect(() => {
    if (!map || mapStatus !== 'ready' || !testMode) return
    const onMapClick = (event: { lngLat: { lat: number; lng: number } }) => {
      const coordinates = { lat: event.lngLat.lat, lng: event.lngLat.lng }
      map.easeTo({ center: [coordinates.lng, coordinates.lat], duration: 300 })
      onTestLocation(coordinates)
    }
    map.on('click', onMapClick)
    return () => { map.off('click', onMapClick) }
  }, [map, mapStatus, onTestLocation, testMode])

  async function goToMyLocation() {
    const position = await moveToMyLocation()
    if (!position) onLocationError(locationError)
  }

  function focusHazard(hazard: Hazard) {
    setScreenReaderListOpen(false)
    onSelect(hazard)
    const marker = markerRefs.current.get(hazard.id)
    if (marker && map) {
      map.easeTo({ center: marker.getLngLat(), duration: 500, offset: [0, -80] })
    }
  }

  function startFilterDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const row = event.currentTarget
    const startX = event.clientX
    const startScrollLeft = row.scrollLeft
    let dragged = false
    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX
      if (!dragged && Math.abs(delta) < 5) return
      dragged = true
      pointerEvent.preventDefault()
      row.scrollLeft = startScrollLeft - delta
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (dragged) suppressFilterClickUntilRef.current = performance.now() + 80
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', end, { once: true })
  }

  function preventFilterClickAfterDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (performance.now() > suppressFilterClickUntilRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressFilterClickUntilRef.current = 0
  }

  return (
    <section className={`map-section ${miniMode ? 'mini-map-section' : ''} ${walkMode ? 'walk-mode-map' : ''} ${filtersOpen ? 'map-filters-open' : ''} ${mobileToolsOpen ? 'map-tools-open' : 'map-tools-collapsed'}`} aria-hidden={walkMode} aria-label={miniMode ? '제보 위치 조정 지도' : walkMode ? '보행 중 위치와 위험 지점 지도' : '대전 보행 위험 지점 지도'}>
      <div className="map-canvas">
        <div className="kakao-map" ref={mapHostRef} aria-label="카카오맵 보행 위험 지도" role="application" />

        {mapStatus === 'ready' && !miniMode && !walkMode && <>
          <section className={`map-filter-bar ${filtersOpen ? 'filters-open' : 'filters-collapsed'}`} aria-label="지도 위험 지점 필터">
            <button type="button" className="map-filter-toggle" aria-expanded={filtersOpen} aria-controls="map-filter-options" onClick={() => setFiltersOpen((open) => !open)}>
              <Filter size={17} />
              <span>유형·상태 필터</span>
              <small>{typeFilter === '전체 유형' ? '전체 유형' : typeFilter} · {statusFilter === '전체 상태' ? '전체 상태' : statusFilter}</small>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            <div id="map-filter-options" className="map-filter-options" hidden={!filtersOpen}>
              <div className="map-filter-row" role="group" aria-label="유형별 위험 필터">
                <span className="map-filter-heading">유형</span>
                <div className="map-filter-chips" onPointerDown={startFilterDrag} onClickCapture={preventFilterClickAfterDrag}>
                  {(['전체 유형', ...hazardTypes] as const).map((type) => <button key={type} type="button" className={`map-filter-chip ${typeFilter === type ? 'active' : ''}`} aria-pressed={typeFilter === type} aria-label={`${type} 위험 보기`} onClick={() => onTypeFilter(type)}>{type}</button>)}
                </div>
              </div>
              <div className="map-filter-row" role="group" aria-label="상태별 위험 필터">
                <span className="map-filter-heading">상태</span>
                <div className="map-filter-chips" onPointerDown={startFilterDrag} onClickCapture={preventFilterClickAfterDrag}>
                  {(['전체 상태', ...hazardStatuses] as const).map((status) => <button key={status} type="button" className={`map-filter-chip status-chip ${statusFilter === status ? 'active' : ''}`} aria-pressed={statusFilter === status} aria-label={`${status} 위험 보기`} onClick={() => onStatusFilter(status)}><i className={`state-dot state-${status}`} />{status}</button>)}
                </div>
              </div>
              <p className="map-filter-swipe-hint">항목을 좌우로 밀어 더 볼 수 있어요</p>
            </div>
          </section>
          <button type="button" className="mobile-map-tools-toggle" aria-expanded={mobileToolsOpen} aria-controls="map-actions-toolbar" aria-label={mobileToolsOpen ? '지도 도구 숨기기' : '지도 도구 열기'} onClick={() => setMobileToolsOpen((open) => { if (open) setScreenReaderListOpen(false); return !open })}>{mobileToolsOpen ? <ChevronUp size={19} /> : <List size={19} />}<span>{mobileToolsOpen ? '도구 숨기기' : '지도 도구'}</span></button>
          {mobileToolsOpen && <div id="map-actions-toolbar" className="map-actions-toolbar" role="group" aria-label="지도 도구">
            <Button variant="secondary" className="add-hazard-map-button" aria-label="새 위험 지점 제보" onClick={onAddHazard}><Plus size={17} /> 위험 제보</Button>
            {!testMode && <Button variant="secondary" className="location-action" aria-label="내 위치로 이동" onClick={goToMyLocation}><LocateFixed size={19} /><span>내 위치</span></Button>}
            <Button type="button" variant="secondary" className="map-sr-list-button" aria-label={`지도에 표시된 위험 지점 목록 ${screenReaderListOpen ? '닫기' : '열기'}`} aria-expanded={screenReaderListOpen} aria-controls="map-screen-reader-hazards" onClick={() => setScreenReaderListOpen((open) => !open)}><List size={17} />목록</Button>
            <div className="map-zoom-controls" role="group" aria-label="지도 확대 및 축소">
              <Button variant="secondary" size="icon" aria-label="지도 확대" onClick={() => map?.zoomIn()}><Plus size={19} /></Button>
              <Button variant="secondary" size="icon" aria-label="지도 축소" onClick={() => map?.zoomOut()}><Minus size={19} /></Button>
            </div>
          </div>}
          {!miniMode && testMode && <p className="map-test-mode-badge" role="status" aria-live="polite">테스트 위치 모드</p>}
          {!miniMode && !testMode && locationPermission === 'prompt' && <p className="location-permission-hint" role="note">현재 위치를 쓰려면 “내 위치”를 누르고 허용해 주세요.</p>}
          {!miniMode && !testMode && locationPermission === 'denied' && <div className="location-permission-hint location-permission-denied" role="status" aria-live="polite"><strong>위치 권한이 꺼져 있어요.</strong><span>{locationError || '브라우저 설정에서 위치를 허용해 주세요.'}</span><details><summary>허용 방법 보기</summary><p>iPhone: 설정 앱에서 Safari 웹 사이트의 위치를 허용해 주세요.</p><p>Android: Chrome 주소창의 사이트 설정에서 위치를 허용해 주세요.</p></details><Button variant="secondary" aria-label="위치 권한 다시 확인" onClick={goToMyLocation}>다시 확인</Button></div>}
          {!miniMode && !testMode && locationPermission === 'unsupported' && <p className="location-permission-hint location-permission-denied" role="status" aria-live="polite">이 브라우저에서는 현재 위치를 사용할 수 없어요. 대전시청 부근 지도를 살펴봐 주세요.</p>}
          <div className="map-legend" aria-label="위험 지점 상태 범례">
            <span><i className="legend-status legend-new" />미신고</span>
            <span><i className="legend-status legend-reported" />신고됨</span>
            <span><i className="legend-status legend-resolved"><Check size={11} /></i>처리완료</span>
          </div>
          <div className="map-note"><Info size={14} /> 표시 범위가 바뀌면 위험 지점을 다시 확인해요</div>
        </>}

        {!miniMode && !walkMode && <>
          <section id="map-screen-reader-hazards" className="map-screen-reader-list" role="region" aria-label="지도에 표시된 위험 지점 목록" hidden={!screenReaderListOpen}>
            <div className="map-screen-reader-list-heading"><strong>위험 지점 목록 <span>({listHazards.length})</span></strong><button type="button" aria-label="위험 지점 목록 패널 닫기" onClick={() => setScreenReaderListOpen(false)}><X size={18} /></button></div>
            <ul>{listHazards.map((hazard) => {
              const status = hazardStatusLabel(hazard.status)
              const distance = Math.max(0, Math.round(haversineMeters(mapCenter, hazard) / 10) * 10)
              return <li key={hazard.id}><button type="button" aria-label={`${hazard.type}, 약 ${distance}미터, 상태 ${status}, ${hazard.title} 상세 보기`} onClick={() => focusHazard(hazard)}><span className={`hazard-list-symbol status-${status === '미신고' ? 'new' : status === '신고됨' ? 'reported' : 'resolved'}`}><span aria-hidden="true">{hazardTypeGlyphs[hazard.type]}</span></span><span className="map-sr-item-copy"><strong>{hazard.type} · 약 {distance}m</strong><span>{hazard.title} · {status}</span></span><span className="sr-status-text">{status}</span></button></li>
            })}</ul>
            {listHazards.length === 0 && <p>선택한 유형과 상태에 해당하는 위험 지점이 없어요.</p>}
          </section>
        </>}

        {mapStatus === 'loading' && <div className="map-state" role="status" aria-live="polite" aria-atomic="true"><div className="map-spinner" aria-hidden="true" /><span>지도를 불러오고 있어요</span></div>}
        {mapStatus === 'error' && <div className="map-state map-error" role="alert" aria-live="assertive" aria-atomic="true"><div className="map-error-icon" aria-hidden="true"><Crosshair size={24} /></div><strong>지도를 불러오지 못했습니다.</strong><span className="map-error-detail">{mapError}</span><Button variant="primary" aria-label="지도 다시 불러오기" onClick={retryMap}>다시 시도</Button></div>}
      </div>
    </section>
  )
}
