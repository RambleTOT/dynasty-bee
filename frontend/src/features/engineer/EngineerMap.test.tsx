import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toEngineerRoute } from '@/adapters/engineerRoute';
import EngineerMap from './EngineerMap';
import styles from './EngineerMap.module.css';

const route = toEngineerRoute({
  transport: 'car',
  start: { lat: 55.7098, lon: 37.7805, label: 'ул. Окская' },
  points: [
    { request_id: '305871402', sequence: 4, lat: 55.7071, lon: 37.7612 },
    { request_id: '305866318', sequence: 5, lat: 55.7133, lon: 37.7481 },
  ],
  geometry: {
    type: 'LineString',
    coordinates: [
      [37.7805, 55.7098],
      [37.7612, 55.7071],
      [37.7481, 55.7133],
    ],
  },
});

describe('EngineerMap (E-04)', () => {
  it('маркеры-номера по sequence и линия маршрута с цветом классом', () => {
    const { container } = render(
      <div style={{ width: 390, height: 600 }}>
        <EngineerMap route={route} />
      </div>,
    );
    const markers = container.querySelectorAll('.leaflet-marker-icon');
    expect([...markers].map((marker) => marker.textContent)).toEqual(['4', '5']);
    expect(markers[0]).toHaveClass(styles.marker);
    expect(markers[0]).toHaveAttribute('title', '№305871402');
    expect(container.querySelector(`path.${styles.line}`)).not.toBeNull();
    expect(container.querySelector(`path.${styles.casing}`)).not.toBeNull();
  });
});
