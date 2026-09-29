import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineerRouteModel } from '@/adapters/engineerRoute';
import { getMyDay, getMyRoute } from '@/api/engineer';
import type { EngineerRoute } from '@/api/types';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import EngineerApp from './EngineerApp';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));
// Leaflet в jsdom не рисует — сама карта проверяется в EngineerMap.test.tsx; точки — кнопками
vi.mock('./EngineerMap', () => ({
  default: ({
    route,
    onPointClick,
  }: {
    route: EngineerRouteModel;
    onPointClick?: (requestId: string) => void;
  }) => (
    <div data-testid="engineer-map">
      {route.points.map((point) => point.sequence).join(',')}
      {route.points.map((point) => (
        <button key={point.requestId} type="button" onClick={() => onPointClick?.(point.requestId)}>
          Точка {point.sequence}
        </button>
      ))}
    </div>
  ),
}));

const route: EngineerRoute = {
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
};

const onShift = (status = 'en_route') =>
  dayRaw([visitRaw('305871402', 4, status), visitRaw('305866318', 5, 'planned')], {
    active_request_id: status === 'planned' ? null : '305871402',
    summary: { total: 9 },
  });

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
  vi.mocked(getMyRoute).mockReset();
  vi.mocked(getMyRoute).mockResolvedValue(route);
});

describe('E-04 «Карта»', () => {
  it('нажали на точку — шторка с заявкой; «Открыть заявку» — карточка, назад — карта без шторки', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift('en_route'));
    renderEngineer({ home: <EngineerApp />, card: <p>Карточка заявки</p> }, '/engineer?view=map');

    fireEvent.click(await screen.findByRole('button', { name: 'Точка 5' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/engineer?view=map&point=305866318');
    const sheet = screen.getByRole('dialog', { name: 'Заявка 5' });
    expect(within(sheet).getByText('СЛЕДУЮЩАЯ · 5 ИЗ 9')).toBeInTheDocument();
    expect(within(sheet).getByText('ул.Окская, д. 5, кв. 13')).toBeInTheDocument();
    expect(within(sheet).getByText('№305866318')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Открыть заявку' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/engineer/request/305866318');
    expect(screen.getByText('Карточка заявки')).toBeInTheDocument();
  });

  it('«Список / Карта»: карта грузит маршрут только когда открыта', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderEngineer({ home: <EngineerApp /> });

    fireEvent.click(await screen.findByRole('tab', { name: 'Карта' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/engineer?view=map');
    await waitFor(() => expect(screen.getByTestId('engineer-map')).toHaveTextContent('4,5'));
    expect(getMyRoute).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(await screen.findByText('ТЕКУЩАЯ · 4 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/engineer$/);
  });

  it('шторка: текущая в пути, ссылки «До следующей» и «Маршрут на день» в Яндекс Карты', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift('en_route'));
    renderEngineer({ home: <EngineerApp /> }, '/engineer?view=map');

    const sheet = await screen.findByRole('region', { name: 'Текущая заявка' });
    expect(within(sheet).getByText('ТЕКУЩАЯ · В ПУТИ')).toBeInTheDocument();
    expect(within(sheet).getByText('№305871402 · ул.Окская, д. 4, кв. 13')).toBeInTheDocument();
    expect(within(sheet).getByText('Заявка 4 · окно 14–16')).toBeInTheDocument();

    const next = await within(sheet).findByRole('link', { name: 'До следующей' });
    expect(within(sheet).getByText('Откроется в Яндекс Картах')).toBeInTheDocument();
    expect(next).toHaveAttribute(
      'href',
      'https://yandex.ru/maps/?rtext=55.709800,37.780500~55.707100,37.761200&rtt=auto',
    );
    expect(next).toHaveAttribute('target', '_blank');
    expect(next).toHaveAttribute('rel', 'noopener');
    expect(within(sheet).getByRole('link', { name: 'Маршрут на день' })).toHaveAttribute(
      'href',
      'https://yandex.ru/maps/?rtext=55.709800,37.780500~55.707100,37.761200~55.713300,37.748100&rtt=auto',
    );
  });

  it('транспорт ссылки — фактический инженера', async () => {
    const day = onShift('in_progress');
    day.engineer.actual_transport = 'bike';
    vi.mocked(getMyDay).mockResolvedValue(day);
    renderEngineer({ home: <EngineerApp /> }, '/engineer?view=map');
    const sheet = await screen.findByRole('region', { name: 'Текущая заявка' });
    expect(within(sheet).getByText('ТЕКУЩАЯ · В РАБОТЕ')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(sheet).getByRole('link', { name: 'До следующей' })).toHaveAttribute(
        'href',
        expect.stringMatching(/&rtt=bc$/),
      ),
    );
  });

  it('следующая ещё не начата — «СЛЕДУЮЩАЯ · К {arrival}»', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift('planned'));
    renderEngineer({ home: <EngineerApp /> }, '/engineer?view=map');
    expect(await screen.findByText('СЛЕДУЮЩАЯ · К 13:30')).toBeInTheDocument();
  });

  it('до смены — только просмотр маршрута, без шторки; «Начать смену» внизу', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('305871402', 1, 'planned')], { shift_status: 'not_started' }),
    );
    renderEngineer({ home: <EngineerApp /> }, '/engineer?view=map');
    expect(await screen.findByTestId('engineer-map')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Текущая заявка' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Начать смену' })).toBeInTheDocument();
  });

  it('смена завершена — вида «Карта» нет', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'done')], { shift_status: 'finished' }),
    );
    renderEngineer({ home: <EngineerApp /> }, '/engineer?view=map');
    await screen.findByText('А. Мельников');
    expect(screen.queryByTestId('engineer-map')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Карта' })).toBeNull();
    expect(getMyRoute).not.toHaveBeenCalled();
  });
});
