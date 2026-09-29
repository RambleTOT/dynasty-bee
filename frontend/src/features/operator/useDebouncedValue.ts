import { useEffect, useState } from 'react';

/** Значение, которое не менялось `delay` мс (поиск и фоновые окна — 300 мс, FRONTEND_SPEC §8.3.4). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
