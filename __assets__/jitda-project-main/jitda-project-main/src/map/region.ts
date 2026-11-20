import type { Coordinates } from './MapContext'

export type RegionFields = { region_name: string; region_code: string }

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'

type NominatimAddress = {
  city?: string
  county?: string
  borough?: string
  city_district?: string
  district?: string
  state?: string
  province?: string
  suburb?: string
  road?: string
  neighbourhood?: string
  'ISO3166-2-lvl4'?: string
  'ISO3166-2-lvl5'?: string
  'ISO3166-2-lvl6'?: string
}

type NominatimResponse = {
  address?: NominatimAddress
  display_name?: string
}

let nominatimQueue: Promise<unknown> = Promise.resolve()
let nextRequestAt = 0

function requestNominatim(coordinates: Coordinates, zoom: number): Promise<NominatimResponse> {
  const request = nominatimQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now())
    if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait))
    nextRequestAt = Date.now() + 1100
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${coordinates.lat}&lon=${coordinates.lng}&zoom=${zoom}&addressdetails=1&accept-language=ko`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('주소 정보를 불러오지 못했어요.')
    return response.json() as Promise<NominatimResponse>
  })
  nominatimQueue = request.then(() => undefined, () => undefined)
  return request
}

export type LocationLookup = RegionFields & { roadName: string; fullName: string }

export async function resolveLocation(coordinates: Coordinates): Promise<LocationLookup> {
  try {
    const result = await requestNominatim(coordinates, 18)
    const address = result.address ?? {}
    const city = address.city ?? address.state ?? address.province ?? ''
    const district = address.county ?? address.borough ?? address.city_district ?? address.district ?? ''
    const regionName = [city, district].filter(Boolean).join(' ')
    const regionCode = address['ISO3166-2-lvl4'] ?? address['ISO3166-2-lvl5'] ?? address['ISO3166-2-lvl6'] ?? 'unknown'
    const roadName = address.road ?? address.neighbourhood ?? address.suburb ?? ''
    const fullName = [regionName, roadName].filter(Boolean).join(' ') || result.display_name || ''
    if (!regionName) throw new Error('행정구역을 찾지 못했어요.')
    return { region_name: regionName, region_code: regionCode, roadName, fullName }
  } catch {
    throw new Error('주소와 행정구역 정보를 불러오지 못했어요.')
  }
}

export async function resolveRegion(coordinates: Coordinates): Promise<RegionFields> {
  const { region_name, region_code } = await resolveLocation(coordinates)
  return { region_name, region_code }
}

export async function resolveRoadAddress(coordinates: Coordinates): Promise<Pick<LocationLookup, 'roadName' | 'fullName'>> {
  const { roadName, fullName } = await resolveLocation(coordinates)
  return { roadName, fullName }
}
