/**
 * useOfflineData — generic hook to read a Dexie table with decryption,
 * falling back to an API queryFn when Dexie has no data and the device is online.
 *
 * IMPORTANT: If you pass a `filterFn` prop, wrap it in `useCallback` at the
 * call site to avoid creating a new function reference on every render, which
 * would trigger an infinite re-fetch loop.
 *
 * @example
 * const filterFn = useCallback((r: OfflineTerritory[]) => r.filter(t => t.type === "urban"), []);
 * const { data, loading, error } = useOfflineData({
 *   tableName: "territories",
 *   queryFn: () => fetchTerritoriesFromApi(token),
 *   filterFn,
 * });
 */
import { useState, useEffect } from "react";
import { getOfflineDB, decryptFromStorage } from "@/lib/offline-db";

export interface UseOfflineDataOptions<T> {
  /** Dexie table name (must match HubportOfflineDB table names). */
  tableName: string;
  /**
   * Async function that fetches data from the API when Dexie has no records.
   * Only called when navigator.onLine is true.
   */
  queryFn?: () => Promise<T[]>;
  /**
   * Optional filter applied after decryption.
   * MUST be memoised with useCallback at the call site to avoid
   * an infinite re-fetch loop.
   */
  filterFn?: (records: T[]) => T[];
  /** Whether to skip loading entirely (e.g. when a required dependency is not yet ready). */
  skip?: boolean;
}

export interface UseOfflineDataResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  /** Refresh from Dexie (and API fallback) on demand. */
  refresh: () => void;
}

export function useOfflineData<T extends Record<string, unknown>>(
  options: UseOfflineDataOptions<T>,
): UseOfflineDataResult<T> {
  const { tableName, queryFn, filterFn, skip = false } = options;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const db = getOfflineDB();
        const table = db.table<T, unknown>(tableName);
        const raw = await table.toArray();

        if (raw.length > 0) {
          // Decrypt each row
          const decrypted = await Promise.all(
            raw.map((r) => decryptFromStorage<T>(tableName, r)),
          );
          const filtered = filterFn ? filterFn(decrypted) : decrypted;
          if (!cancelled) {
            setData(filtered);
            setLoading(false);
          }
          return;
        }

        // Dexie empty — try API fallback if online and queryFn provided
        if (navigator.onLine && queryFn) {
          const apiData = await queryFn();
          if (!cancelled) {
            const filtered = filterFn ? filterFn(apiData) : apiData;
            setData(filtered);
          }
        } else if (!cancelled) {
          setData([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // filterFn intentionally included — callers must memoize with useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, queryFn, filterFn, skip, tick]);

  function refresh() {
    setTick((t) => t + 1);
  }

  return { data, loading, error, refresh };
}
