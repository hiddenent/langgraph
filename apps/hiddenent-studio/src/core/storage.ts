// 미디어 라이브러리 로컬 영구 저장(IndexedDB). 외부 서버로는 아무것도 전송하지 않는다.

export type MediaKind = 'video' | 'photo';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  width: number;
  height: number;
  /** 동영상 길이(ms) */
  durationMs?: number;
  thumbnail: string;
  blob: Blob;
  /** 전후 비교용 이미지(사진: 보정 전, 동영상: 시작 프레임) */
  beforeThumb?: string;
  /** 동영상 종료 프레임 */
  afterThumb?: string;
  meta: Record<string, string>;
  /** IndexedDB 에 저장되어 있는지(아니면 현재 탭 메모리에만 존재) */
  persisted: boolean;
}

const DB_NAME = 'hiddenent-studio';
const STORE = 'media';
const VERSION = 1;

export function indexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbSupported()) return Promise.reject(new Error('이 브라우저는 IndexedDB 를 지원하지 않습니다.'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('로컬 저장소를 열 수 없습니다(사생활 보호 모드일 수 있습니다).'));
      };
      req.onblocked = () => reject(new Error('다른 탭에서 저장소를 사용 중입니다. 다른 탭을 닫고 다시 시도하세요.'));
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        let result: T | undefined;
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('저장이 중단되었습니다.'));
      }),
  );
}

export function describeStorageError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return '브라우저 저장 공간이 부족합니다. 라이브러리에서 오래된 파일을 삭제하거나 파일을 다운로드한 뒤 로컬 보관을 해제하세요.';
  }
  if (name === 'InvalidStateError' || name === 'UnknownError') {
    return '로컬 저장소에 접근할 수 없습니다. 사생활 보호(시크릿) 모드이거나 브라우저 저장소가 차단되었을 수 있습니다.';
  }
  return err instanceof Error ? err.message : '로컬 저장 중 알 수 없는 오류가 발생했습니다.';
}

export async function saveItem(item: MediaItem): Promise<void> {
  const est = await estimateStorage();
  if (est && est.quota > 0 && est.usage + item.size > est.quota * 0.95) {
    const e = new Error('저장 공간 부족');
    e.name = 'QuotaExceededError';
    throw e;
  }
  await tx('readwrite', (s) => s.put({ ...item, persisted: true }));
}

export async function deleteItem(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function loadAll(): Promise<MediaItem[]> {
  const items = (await tx<MediaItem[]>('readonly', (s) => s.getAll() as IDBRequest<MediaItem[]>)) ?? [];
  return items.map((i) => ({ ...i, persisted: true }));
}

export async function renameItem(id: string, name: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    const g = s.get(id);
    g.onsuccess = () => {
      if (g.result) s.put({ ...g.result, name });
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export interface StorageEstimateInfo {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

export async function estimateStorage(): Promise<StorageEstimateInfo | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

/** 브라우저가 저장소를 자동 정리하지 않도록 영구 저장을 요청한다(브라우저가 거절할 수 있음). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
