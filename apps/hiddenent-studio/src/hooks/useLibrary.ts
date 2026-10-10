import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MediaItem,
  StorageEstimateInfo,
  deleteItem,
  describeStorageError,
  estimateStorage,
  indexedDbSupported,
  loadAll,
  renameItem,
  saveItem,
} from '../core/storage';

export interface LibraryHandle {
  items: MediaItem[];
  loading: boolean;
  estimate: StorageEstimateInfo | null;
  add(item: MediaItem): Promise<void>;
  remove(ids: string[]): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  persist(id: string): Promise<void>;
  unpersist(id: string): Promise<void>;
  replaceBlob(id: string, patch: Partial<MediaItem>): Promise<void>;
  refreshEstimate(): Promise<void>;
  /** 메모리에만 있는(저장되지 않은) 항목 수 */
  unsavedCount: number;
}

export function useLibrary(autoPersist: boolean, onError: (msg: string) => void): LibraryHandle {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<StorageEstimateInfo | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const errRef = useRef(onError);
  errRef.current = onError;

  const refreshEstimate = useCallback(async () => {
    setEstimate(await estimateStorage());
  }, []);

  useEffect(() => {
    if (!indexedDbSupported()) {
      setLoading(false);
      return;
    }
    loadAll()
      .then((stored) => setItems((cur) => [...cur.filter((c) => !stored.some((s) => s.id === c.id)), ...stored]))
      .catch((e) => errRef.current(describeStorageError(e)))
      .finally(() => setLoading(false));
    void refreshEstimate();
  }, [refreshEstimate]);

  const persist = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.persisted) return;
      try {
        await saveItem(item);
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, persisted: true } : i)));
      } catch (e) {
        errRef.current(describeStorageError(e));
      } finally {
        void refreshEstimate();
      }
    },
    [refreshEstimate],
  );

  const add = useCallback(
    async (item: MediaItem) => {
      setItems((cur) => [item, ...cur]);
      if (autoPersist && indexedDbSupported()) {
        try {
          await saveItem(item);
          setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, persisted: true } : i)));
        } catch (e) {
          errRef.current(`${describeStorageError(e)} 파일은 현재 탭의 임시 메모리에만 보관됩니다.`);
        } finally {
          void refreshEstimate();
        }
      }
    },
    [autoPersist, refreshEstimate],
  );

  const remove = useCallback(
    async (ids: string[]) => {
      const targets = itemsRef.current.filter((i) => ids.includes(i.id));
      setItems((cur) => cur.filter((i) => !ids.includes(i.id)));
      for (const t of targets) {
        if (t.persisted) {
          try {
            await deleteItem(t.id);
          } catch (e) {
            errRef.current(describeStorageError(e));
          }
        }
      }
      void refreshEstimate();
    },
    [refreshEstimate],
  );

  const unpersist = useCallback(
    async (id: string) => {
      try {
        await deleteItem(id);
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, persisted: false } : i)));
      } catch (e) {
        errRef.current(describeStorageError(e));
      }
      void refreshEstimate();
    },
    [refreshEstimate],
  );

  const rename = useCallback(async (id: string, name: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, name } : i)));
    if (item?.persisted) {
      try {
        await renameItem(id, name);
      } catch (e) {
        errRef.current(describeStorageError(e));
      }
    }
  }, []);

  const replaceBlob = useCallback(
    async (id: string, patch: Partial<MediaItem>) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;
      const next = { ...item, ...patch };
      setItems((cur) => cur.map((i) => (i.id === id ? next : i)));
      if (item.persisted) {
        try {
          await saveItem(next);
        } catch (e) {
          errRef.current(describeStorageError(e));
        }
        void refreshEstimate();
      }
    },
    [refreshEstimate],
  );

  const unsavedCount = items.filter((i) => !i.persisted).length;

  return { items, loading, estimate, add, remove, rename, persist, unpersist, replaceBlob, refreshEstimate, unsavedCount };
}
