import { useEffect, useRef, useState } from 'react'
import { Marker } from 'maplibre-gl'
import { Check, ChevronDown, Crosshair, Filter, Info, List, LocateFixed, Minus, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { useMapContext, type Coordinates } from '../map/MapContext'
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
  miniMode, dragPinEnabled, reportLocation, onReportLocationChange,
  testMode, testLocation, onTestLocation, mapVisible, walkMode,
}: Props) {
  const { map, mapStatus, mapHostRef, retryMap, moveToMyLocation, currentLocation, locationPermission, locationError } = useMapContext()
  const [screenReaderListOpen, setScreenReaderListOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const markerRefs = useRef<Map<string, Marker>>(new Map())
  const dragMarkerRef = useRef<Marker | null>(null)
  const testMarkerRef = useRef<Marker | null>(null)

  const mapCenter = (testMode && testLocation)
    ? testLocation
    : currentLocation ?? (map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : { lat: 36.3504, lng: 127.3845 })
  const listHazards = hazards
    .filter((hazard) => isShown(hazard, visibleIds, typeFilter, statusFilter))
    .sort((first, second) => haversineMeters(mapCenter, first) - haversineMeters(mapCenter, second))

  useEffect(() => {
    if (mapStatus !== 'ready' || !map) return
    const markers = new Map<string, Marker>()
    hazards.forEach((hazard) => {
      const element = document.createElement('button')
      element.type = 'button'
      const displayStatus = hazardStatusLabel(hazard.status)
      const resolved = displayStatus === '처리완료'
      element.className = `sdk-hazard status-${displayStatus === '미신고' ? 'new' : displayStatus === '신고됨' ? 'reported' : 'resolved'}`
      element.setAttribute('aria-label', `${hazard.type}, ${displayStatus}, ${hazard.title}`)
      const glyph = document.createElement('span')
      glyph.className = 'sdk-hazard-glyph'
      glyph.textContent = hazardTypeGlyphs[hazard.type]
      const label = document.createElement('span')
      label.className = 'sdk-hazard-label'
      label.textContent = hazardTypeLabels[hazard.type]
      const state = document.createElement('span')
      state.className = 'sdk-hazard-state'
      state.textContent = resolved ? '처리완료 ✓' : displayStatus
      element.append(glyph, label, state)
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelect(hazard)
      })
      const marker = new Marker({ element, anchor: 'bottom' }).setLngLat([hazard.lng, hazard.lat])
      markers.set(hazard.id, marker)
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
    }
  }, [hazards, map, mapStatus, onSelect, onVisibleIds])

  useEffect(() => {
    if (!map) return
    const shownIds = new Set<string>()
    markerRefs.current.forEach((marker, id) => {
      const hazard = hazards.find((item) => item.id === id)
      const activeHazard = hazard && hazard.status !== 'fixed' && hazard.status !== '처리완료'
      const shouldShow = hazard && !miniMode && (walkMode ? activeHazard : isShown(hazard, visibleIds, typeFilter, statusFilter))
      if (shouldShow) {
        shownIds.add(id)
        marker.addTo(map)
      } else marker.remove()
    })
  }, [hazards, map, miniMode, statusFilter, typeFilter, visibleIds, walkMode])

  useEffect(() => {
    if (!map || mapStatus !== 'ready') return
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
      dragMarkerRef.current = new Marker({ element, draggable: true })
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
  }, [dragPinEnabled, map, mapStatus, miniMode, onReportLocationChange, reportLocation])

  useEffect(() => {
    if (!map || mapStatus !== 'ready' || !mapVisible) return
    const timer = window.setTimeout(() => map.resize(), 120)
    return () => window.clearTimeout(timer)
  }, [map, mapStatus, mapVisible, miniMode])

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
      testMarkerRef.current = new Marker({ element })
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

  return (
    <section className={`map-section ${miniMode ? 'mini-map-section' : ''} ${walkMode ? 'walk-mode-map' : ''} ${filtersOpen ? 'map-filters-open' : ''}`} aria-hidden={walkMode} aria-label={miniMode ? '제보 위치 조정 지도' : walkMode ? '보행 중 위치와 위험 지점 지도' : '대전 보행 위험 지점 지도'}>
      <div className="map-canvas">
        <div className="maplibre-map" ref={mapHostRef} aria-label="OpenFreeMap 지도" role="application" />

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
                <div className="map-filter-chips">
                  {(['전체 유형', ...hazardTypes] as const).map((type) => <button key={type} type="button" className={`map-filter-chip ${typeFilter === type ? 'active' : ''}`} aria-pressed={typeFilter === type} aria-label={`${type} 위험 보기`} onClick={() => onTypeFilter(type)}>{type}</button>)}
                </div>
              </div>
              <div className="map-filter-row" role="group" aria-label="상태별 위험 필터">
                <span className="map-filter-heading">상태</span>
                <div className="map-filter-chips">
                  {(['전체 상태', ...hazardStatuses] as const).map((status) => <button key={status} type="button" className={`map-filter-chip status-chip ${statusFilter === status ? 'active' : ''}`} aria-pressed={statusFilter === status} aria-label={`${status} 위험 보기`} onClick={() => onStatusFilter(status)}><i className={`state-dot state-${status}`} />{status}</button>)}
                </div>
              </div>
              <p className="map-filter-swipe-hint">항목을 좌우로 밀어 더 볼 수 있어요</p>
            </div>
          </section>
          <div className="map-actions-toolbar" role="group" aria-label="지도 도구">
            <Button variant="secondary" className="add-hazard-map-button" aria-label="새 위험 지점 제보" onClick={onAddHazard}><Plus size={17} /> 위험 제보</Button>
            {!testMode && <Button variant="secondary" className="location-action" aria-label="내 위치로 이동" onClick={goToMyLocation}><LocateFixed size={19} /><span>내 위치</span></Button>}
            <Button type="button" variant="secondary" className="map-sr-list-button" aria-label={`지도에 표시된 위험 지점 목록 ${screenReaderListOpen ? '닫기' : '열기'}`} aria-expanded={screenReaderListOpen} aria-controls="map-screen-reader-hazards" onClick={() => setScreenReaderListOpen((open) => !open)}><List size={17} />목록</Button>
            <div className="map-zoom-controls" role="group" aria-label="지도 확대 및 축소">
              <Button variant="secondary" size="icon" aria-label="지도 확대" onClick={() => map?.zoomIn()}><Plus size={19} /></Button>
              <Button variant="secondary" size="icon" aria-label="지도 축소" onClick={() => map?.zoomOut()}><Minus size={19} /></Button>
            </div>
          </div>
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
            <div className="map-screen-reader-list-heading"><strong>지도에 표시된 위험 지점</strong><button type="button" aria-label="위험 지점 목록 패널 닫기" onClick={() => setScreenReaderListOpen(false)}><X size={18} /></button></div>
            <ul>{listHazards.map((hazard) => {
              const status = hazardStatusLabel(hazard.status)
              const distance = Math.max(0, Math.round(haversineMeters(mapCenter, hazard) / 10) * 10)
              return <li key={hazard.id}><button type="button" aria-label={`${hazard.type}, 약 ${distance}미터, 상태 ${status}, ${hazard.title} 상세 보기`} onClick={() => focusHazard(hazard)}><span className={`hazard-list-symbol status-${status === '미신고' ? 'new' : status === '신고됨' ? 'reported' : 'resolved'}`}><span aria-hidden="true">{hazardTypeGlyphs[hazard.type]}</span></span><span className="map-sr-item-copy"><strong>{hazard.type} · 약 {distance}m</strong><span>{hazard.title} · {status}</span></span><span className="sr-status-text">{status}</span></button></li>
            })}</ul>
            {listHazards.length === 0 && <p>현재 지도 범위에 표시된 위험 지점이 없어요.</p>}
          </section>
        </>}

        {mapStatus === 'loading' && <div className="map-state" role="status" aria-live="polite" aria-atomic="true"><div className="map-spinner" aria-hidden="true" /><span>지도를 불러오고 있어요</span></div>}
        {mapStatus === 'error' && <div className="map-state map-error" role="alert" aria-live="assertive" aria-atomic="true"><div className="map-error-icon" aria-hidden="true"><Crosshair size={24} /></div><strong>지도를 불러오지 못했습니다.<br />잠시 후 다시 시도해 주세요.</strong><Button variant="primary" aria-label="지도 다시 불러오기" onClick={retryMap}>다시 시도</Button></div>}
      </div>
    </section>
  )
}
