import { useEffect, useRef, useState } from "react";

/**
 * Mirror a slice of app state into localStorage.
 *
 * The workflow is manual: images are made outside the app and the app holds the
 * story, cast and cut. Reloading used to drop all of it, so every state slice the
 * operator cannot trivially recreate is persisted here.
 */
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      return typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      if (typeof value === "string" && value === "") {
        window.localStorage.removeItem(keyRef.current);
        return;
      }
      window.localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      // Quota or private-mode failures must not break editing.
    }
  }, [value]);

  return [value, setValue];
}

/** Wipe every persisted slice. Used by the reset control. */
export function clearPersistedState(keys: string[]): void {
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
