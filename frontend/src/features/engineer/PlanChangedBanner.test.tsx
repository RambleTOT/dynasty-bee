import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay } from '@/api/engineer';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import EngineerApp from './EngineerApp';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

const visits = [visitRaw('305857695', 7, 'planned'), visitRaw('305871402', 4, 'in_progress')];

const banners = [
  {
    type: 'order_changed',
    text: 'Порядок изменён: №…7695 теперь 7-я',
    at: '12:40',
    request_id: '305857695',
  },
  { type: 'cancel_confirmed', text: 'Отмена №…1402 подтверждена', at: '12:10' },
];

const renderApp = () => renderEngineer({ home: <EngineerApp />, card: <p>Карточка заявки</p> });

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
});

describe('E-09 «План изменён»', () => {
  it('самый свежий непросмотренный; «Посмотреть» — карточка заявки и отметка в localStorage', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw(visits, { banners, active_request_id: '305871402' }),
    );
    renderApp();
    expect(await screen.findByText('План изменён')).toBeInTheDocument();
    expect(screen.getByText('Порядок изменён: №…7695 теперь 7-я')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть' }));
    expect(await screen.findByText('Карточка заявки')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/engineer/request/305857695');
    expect(window.localStorage.getItem('seen_banner_12:40_order_changed')).not.toBeNull();
  });

  it('просмотренный не показываем — следующий по свежести', async () => {
    window.localStorage.setItem('seen_banner_12:40_order_changed', '1');
    vi.mocked(getMyDay).mockResolvedValue(dayRaw(visits, { banners }));
    renderApp();
    expect(await screen.findByText('Отмена №…1402 подтверждена')).toBeInTheDocument();
    expect(screen.queryByText('Порядок изменён: №…7695 теперь 7-я')).toBeNull();
  });

  it('без заявки в баннере — остаёмся на списке, следующий баннер после просмотра', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw(visits, {
        banners: [
          {
            type: 'handed_over',
            text: 'Заявка №…0001 передана другому инженеру',
            at: '13:00',
            request_id: '0001',
          },
          banners[1],
        ],
      }),
    );
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть' }));
    expect(await screen.findByText('Отмена №…1402 подтверждена')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/engineer$/);
    expect(window.localStorage.getItem('seen_banner_13:00_handed_over')).not.toBeNull();
  });

  it('баннеров нет — плашки нет', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw(visits));
    renderApp();
    await screen.findByText('А. Мельников');
    expect(screen.queryByText('План изменён')).toBeNull();
  });

  it('«Не могу работать» принят, баннера нет — «С {available_until} ваши заявки передадут…»', async () => {
    const day = dayRaw(visits, { shift_status: 'unavailable' });
    day.engineer.available_until = '15:00';
    vi.mocked(getMyDay).mockResolvedValue(day);
    renderApp();
    await waitFor(() =>
      expect(
        screen.getByText('С 15:00 ваши заявки передадут другим после решения диспетчера'),
      ).toBeInTheDocument(),
    );
  });
});
