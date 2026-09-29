/**
 * Поле адреса с подсказками при вводе (Photon, ближе к центру Москвы — выше) и выбором точки на
 * карте. Подсказка или точка дают и координаты (`onPick`), просто ввод — только текст (`onChange`).
 * Сервис подсказок выключен (`VITE_ADDRESS_SUGGEST_URL=off`) или не ответил — обычное поле.
 */
import { useQuery } from '@tanstack/react-query';
import { MapPin, MapPinned } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { addressSuggestEnabled, suggestAddresses } from '@/api/geocoder';
import { parseSuggestions, type AddressSuggestion } from '@/adapters/address';
import { ADDRESS_SUGGEST } from '@/config';
import { cx, IconButton, Input } from '@/ui';
import { AddressMapModal } from './AddressMapModal';
import styles from './AddressInput.module.css';

export function AddressInput({
  label,
  value,
  onChange,
  onPick,
  point = null,
  error,
  hint,
  suffix,
  tone,
  withMap = true,
  localSuggestions,
  fieldClassName,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Подсказка или точка на карте: адрес с координатами. */
  onPick?: (suggestion: AddressSuggestion) => void;
  /** Точка выбранного адреса — с неё начнётся карта. */
  point?: { lat: number; lon: number } | null;
  error?: ReactNode;
  hint?: ReactNode;
  suffix?: ReactNode;
  tone?: 'filled' | 'white';
  withMap?: boolean;
  /** Свои подсказки (адреса заявок дня) — выше подсказок сервиса. */
  localSuggestions?: readonly AddressSuggestion[];
  fieldClassName?: string;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [mapOpen, setMapOpen] = useState(false);
  // выбранный адрес повторно не подсказываем
  const [picked, setPicked] = useState<string | null>(null);

  const query = value.trim();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), ADDRESS_SUGGEST.debounceMs);
    return () => clearTimeout(timer);
  }, [query]);

  const wanted =
    addressSuggestEnabled &&
    focused &&
    debounced.length >= ADDRESS_SUGGEST.minChars &&
    debounced !== picked;
  const suggestions = useQuery({
    queryKey: ['address', 'suggest', debounced],
    queryFn: async ({ signal }) => parseSuggestions(await suggestAddresses(debounced, signal)),
    enabled: wanted,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const needle = query.toLowerCase();
  const local =
    focused && needle && needle !== picked?.toLowerCase()
      ? (localSuggestions ?? []).filter((s) => s.value.toLowerCase().includes(needle)).slice(0, 3)
      : [];
  const remote = wanted ? (suggestions.data ?? []) : [];
  const items = open
    ? [...local, ...remote.filter((s) => !local.some((l) => l.value === s.value))]
    : [];
  const shown = items.length > 0;

  const pick = (suggestion: AddressSuggestion) => {
    setPicked(suggestion.value);
    setOpen(false);
    setActive(-1);
    onChange(suggestion.value);
    onPick?.(suggestion);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shown) {
      if (event.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === 'Escape') {
      // закрываем список, а не окно вокруг поля
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={cx(styles.wrap, fieldClassName)}>
      <Input
        label={label}
        icon={MapPin}
        value={value}
        tone={tone}
        error={error}
        hint={hint}
        suffix={suffix}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        trailing={
          withMap ? (
            <IconButton
              icon={MapPinned}
              label="Выбрать на карте"
              variant="ghost"
              size="sm"
              onClick={() => setMapOpen(true)}
            />
          ) : undefined
        }
      />
      {shown && (
        <ul id={listId} role="listbox" className={styles.list} aria-label="Подсказки адреса">
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cx(styles.option, index === active && styles.active)}
              // mousedown, а не click: иначе поле потеряет фокус и список закроется раньше
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className={styles.title}>{item.title}</span>
              {item.subtitle && <span className={styles.subtitle}>{item.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}
      {mapOpen && (
        <AddressMapModal
          initial={point}
          onPick={(suggestion) => {
            setMapOpen(false);
            pick(suggestion);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}
