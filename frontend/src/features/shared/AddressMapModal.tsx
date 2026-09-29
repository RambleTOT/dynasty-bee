/**
 * Адрес точкой на карте: клик ставит метку, адрес точки — из Photon (api/geocoder.ts),
 * «Выбрать адрес» отдаёт его полю. Карта — Яндекс (useYandexMap); не загрузилась — просим
 * выбрать адрес из подсказок.
 */
import { useQuery } from '@tanstack/react-query';
import { MapPinned } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { reverseAddress } from '@/api/geocoder';
import { parseSuggestions, type AddressSuggestion } from '@/adapters/address';
import { Button, EmptyState, Modal, Spinner } from '@/ui';
import { useYandexMap } from './useYandexMap';
import styles from './AddressMapModal.module.css';

type Point = { lat: number; lon: number };

export function AddressMapModal({
  initial,
  onPick,
  onClose,
}: {
  /** Уже выбранная точка адреса: карта начнётся с неё. */
  initial: Point | null;
  onPick: (suggestion: AddressSuggestion) => void;
  onClose: () => void;
}) {
  const { element, handle, failed } = useYandexMap({ controls: ['zoomControl'] });
  const [point, setPoint] = useState<Point | null>(initial);
  const initialRef = useRef(initial);

  // клик по карте — точка; стартовая точка — центр
  useEffect(() => {
    if (!handle) return;
    const start = initialRef.current;
    if (start) handle.map.setCenter([start.lat, start.lon], 16);
    handle.map.events.add('click', (event) => {
      const coords = event.get('coords');
      if (Array.isArray(coords) && coords.length >= 2) {
        setPoint({ lat: Number(coords[0]), lon: Number(coords[1]) });
      }
    });
  }, [handle]);

  // метка в выбранной точке
  useEffect(() => {
    if (!handle) return;
    handle.map.geoObjects.removeAll();
    if (point) {
      handle.map.geoObjects.add(
        new handle.ymaps.Placemark([point.lat, point.lon], {}, { preset: 'islands#redDotIcon' }),
      );
    }
  }, [handle, point]);

  const address = useQuery({
    queryKey: ['address', 'reverse', point?.lat.toFixed(5), point?.lon.toFixed(5)],
    queryFn: async ({ signal }) => {
      const found = parseSuggestions(await reverseAddress(point!.lat, point!.lon, signal))[0];
      // координаты — точки клика: адрес ближайшего дома может стоять в стороне
      return found ? { ...found, lat: point!.lat, lon: point!.lon } : null;
    },
    enabled: Boolean(point),
    staleTime: 10 * 60_000,
    retry: false,
  });

  let status;
  if (!point) status = 'Нажмите на карту в месте адреса';
  else if (address.isPending) status = <Spinner size={16} label="Ищем адрес точки" />;
  else if (address.data) status = <b>{address.data.value}</b>;
  else status = 'Адрес этой точки не нашли — нажмите ближе к дому';

  return (
    <Modal
      open
      width={720}
      onClose={onClose}
      title="Адрес на карте"
      subtitle="Поставьте метку — подставим адрес этой точки"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            icon={MapPinned}
            disabled={!address.data}
            onClick={() => address.data && onPick(address.data)}
          >
            Выбрать адрес
          </Button>
        </>
      }
    >
      <div className={styles.status}>{status}</div>
      {failed ? (
        <EmptyState icon={MapPinned} title="Карта недоступна">
          Выберите адрес из подсказок в поле
        </EmptyState>
      ) : (
        <div ref={element} className={styles.map} />
      )}
    </Modal>
  );
}
