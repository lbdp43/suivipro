import { useState, useEffect, useCallback } from 'react';

/**
 * Hook qui persiste l'etat dans localStorage.
 * Quand on change de page et qu'on revient, les filtres sont restaures.
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `suivipro_filters_${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [storageKey, value]);

  return [value, setValue];
}
