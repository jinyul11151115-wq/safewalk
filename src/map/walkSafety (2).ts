import type { Coordinates } from './MapContext'
import type { Hazard, HazardType } from './hazards'

export type WalkUserType = '휠체어' | '시각장애' | '고령자·유모차' | '일반'

export const walkUserTypes: WalkUserType[] = ['휠체어', '시각장애', '고령자·유모차', '일반']

export const defaultWarningRadii: Record<WalkUserType, number> = {
  휠체어: 50,
  시각장애: 40,
  '고령자·유모차': 30,
  일반: 20,
}

const wheelchairHazardTypes = new Set<HazardType>(['단차·턱', '급경사', '가로수 뿌리', '좁은 보도'])

export function haversineMeters(from: Coordinates, to: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDelta = radians(to.lat - from.lat)
  const lngDelta = radians(to.lng - from.lng)
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function passableValue(hazard: Hazard, userType: WalkUserType): boolean | null {
  if (userType === '휠체어') {
    if (typeof hazard.passable_wheelchair === 'boolean') return hazard.passable_wheelchair
    if (hazard.passability) return hazard.passability.wheelchair === '지나갈 수 있음'
    return hazard.wheelchair
  }
  if (userType === '고령자·유모차') {
    if (typeof hazard.passable_stroller === 'boolean') return hazard.passable_stroller
    if (hazard.passability) return hazard.passability.stroller === '지나갈 수 있음'
    return hazard.stroller
  }
  return null
}

export function isHazardRelevant(hazard: Hazard, userType: WalkUserType) {
  if (hazard.status === 'fixed' || hazard.status === '처리완료') return false
  if (userType === '시각장애' || userType === '일반') return true
  if (userType === '휠체어') return wheelchairHazardTypes.has(hazard.type) && passableValue(hazard, userType) === false
  return passableValue(hazard, userType) === false
}

export function hazardSpeech(hazard: Hazard, userType: WalkUserType, distance: number) {
  const roundedDistance = Math.max(10, Math.round(distance / 10) * 10)
  const description: Record<HazardType, string> = {
    '가로수 뿌리': '나무뿌리로 보도가 울퉁불퉁한 구간입니다',
    '보도블록 파손': '보도블록이 깨진 구간입니다',
    '단차·턱': '보도에 단차가 있는 구간입니다',
    '급경사': '경사가 가파른 구간입니다',
    '좁은 보도': '보도가 좁은 구간입니다',
    '공사 장애물': '공사 장애물이 있는 구간입니다',
    '맨홀·배수구': '맨홀이나 배수구가 있는 구간입니다',
    '미끄러운 노면': '바닥이 미끄러운 구간입니다',
  }
  const passText = userType === '휠체어'
    ? hazard.passability?.wheelchair ?? ((hazard.passable_wheelchair ?? hazard.wheelchair) ? '지나갈 수 있음' : '어려움')
    : userType === '고령자·유모차'
      ? hazard.passability?.stroller ?? ((hazard.passable_stroller ?? hazard.stroller) ? '지나갈 수 있음' : '어려움')
      : null
  const detail = passText === '불가능'
    ? `${userType} 통행이 불가능합니다.`
    : passText === '어려움'
      ? `${userType} 통행이 어렵습니다.`
      : passText === '지나갈 수 있음'
        ? `${userType} 통행은 가능하지만 조심해 주세요.`
        : userType === '시각장애'
          ? '지팡이나 안내견으로 바닥을 확인해 주세요.'
          : '주변을 살펴 천천히 이동해 주세요.'
  return `주의. 약 ${roundedDistance}미터 앞, ${description[hazard.type]}. ${detail}`
}
