import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { YandexRouteMap } from './YandexRouteMap';

describe('YandexRouteMap', () => {
  it('без ключа Яндекс Карт — запасная карта', () => {
    render(
      <YandexRouteMap
        start={{ lat: 55.7, lon: 37.6 }}
        stops={[{ lat: 55.71, lon: 37.61, number: 1 }]}
        transport="car"
        colorVar="--route-1"
        fallback={<p>Карта OSM</p>}
      />,
    );
    expect(screen.getByText('Карта OSM')).toBeInTheDocument();
  });
});
