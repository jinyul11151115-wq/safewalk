type PhotoInput = { id: string; dataUrl: string; name: string }

const DATABASE = 'safe-walk-demo-storage'
const STORE = 'hazard-photos'

function openPhotoDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('사진을 저장할 수 없어요.'))
  })
}

export async function saveDemoPhotos(photos: PhotoInput[]) {
  const entries = await Promise.all(photos.map(async (photo) => ({ ...photo, blob: await (await fetch(photo.dataUrl)).blob() })))
  const database = await openPhotoDatabase()
  try {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('사진 저장에 실패했어요.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('사진 저장이 취소됐어요.'))
    })
    entries.forEach(({ id, name, blob }) => store.put({ id, name, blob }))
    await completed
  } finally {
    database.close()
  }
}

export async function loadDemoPhotoUrl(id: string) {
  const database = await openPhotoDatabase()
  try {
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      request.onsuccess = () => resolve(request.result?.blob ?? null)
      request.onerror = () => reject(request.error)
    })
    return blob ? URL.createObjectURL(blob) : null
  } finally {
    database.close()
  }
}
