import { useState, useEffect, useRef } from 'react';

/**
 * Polling hook — calls `fetcher` every `intervalMs` milliseconds.
 * Used for live-ish updates on job explorer and worker status pages
 * per SPEC.md Section 1 (polling every 3-5s, not WebSockets).
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 4000
): { data: T | null; error: string | null; isLoading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const runFetch = async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    runFetch();
    const interval = setInterval(runFetch, intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return { data, error, isLoading, refetch: runFetch };
}

/**
 * One-shot fetch hook (no polling).
 */
export function useFetch<T>(
  fetcher: () => Promise<T>
): { data: T | null; error: string | null; isLoading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const runFetch = async () => {
    setIsLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { runFetch(); }, []);

  return { data, error, isLoading, refetch: runFetch };
}
