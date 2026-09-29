import { describe, expect, it } from 'vitest';
import { yandexRouteUrl, type LatLon } from './yandexMaps';

const start: LatLon = { lat: 55.70981, lon: 37.7805 };
const a: LatLon = { lat: 55.7071, lon: 37.7612 };
const b: LatLon = { lat: 55.7133, lon: 37.74813 };

describe('yandexRouteUrl', () => {
  it('старт и точки через «~», 6 знаков, тип маршрута по транспорту', () => {
    expect(yandexRouteUrl(start, [a, b], 'car')).toBe(
      'https://yandex.ru/maps/?rtext=55.709810,37.780500~55.707100,37.761200~55.713300,37.748130&rtt=auto',
    );
  });

  it('rtt для всех видов транспорта', () => {
    expect(yandexRouteUrl(start, [a], 'public_transport')).toMatch(/&rtt=mt$/);
    expect(yandexRouteUrl(start, [a], 'walk')).toMatch(/&rtt=pd$/);
    expect(yandexRouteUrl(start, [a], 'bike')).toMatch(/&rtt=bc$/);
  });

  it('не больше 20 точек вместе со стартом', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ lat: 55 + i / 100, lon: 37 }));
    const rtext = new URL(yandexRouteUrl(start, points, 'car')).searchParams.get('rtext') ?? '';
    const parts = rtext.split('~');
    expect(parts).toHaveLength(20);
    expect(parts[0]).toBe('55.709810,37.780500');
    expect(parts[19]).toBe('55.180000,37.000000');
  });
});
