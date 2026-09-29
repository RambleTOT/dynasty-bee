import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelBooking, searchRequests } from '@/api/booking';
import { ApiError } from '@/api/errors';
import type { BookingSearchItem } from '@/api/types';
import { dismissAll } from '@/lib/notify';
import { renderScreen } from '../testUtils';
import SearchPage from './SearchPage';

vi.mock('@/api/booking', () => ({ searchRequests: vi.fn(), cancelBooking: vi.fn() }));
// сценарии страницы — без «Другое» (флаг cancelComment выключен); «Другое» проверяет CancelBlock.test.tsx
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, cancelComment: false } };
});

/** Строки ответа без полей ⏳ 9.2 — как в живой схеме 28.09. */
const planned: BookingSearchItem = {
  request_id: '100001',
  region_id: 'east',
  date: '2026-09-29',
  window: '18:00-20:00',
  address: 'ул. Тестовая, д. 1, кв. 2',
  type_bk: 'Подключение',
  type_hd: 'Заявка на подключение',
  status: 'planned',
};
const done: BookingSearchItem = {
  request_id: '100002',
  region_id: 'east',
  date: '2026-09-26',
  window: '12:00-14:00',
  address: 'ул. Тестовая, д. 5',
  type_bk: 'Локальная заявка',
  type_hd: 'Нет линка',
  status: 'done',
};

function renderSearch(url = '/operator') {
  return renderScreen(<SearchPage />, { path: '/operator', url });
}

const searchBox = () => screen.getByRole('textbox', { name: 'Найти заявку' });
const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z')); // 12:00 по Москве
  vi.mocked(searchRequests).mockResolvedValue([done, planned]);
});

afterEach(() => {
  act(() => dismissAll());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('O-02 поиск', () => {
  it('до 3 символов — подсказка, запросов нет', async () => {
    renderSearch();
    expect(screen.getByText('Введите № заявки или адрес')).toBeInTheDocument();
    expect(screen.getByText('Выберите заявку слева')).toBeInTheDocument();
    fireEvent.change(searchBox(), { target: { value: 'ул' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchRequests).not.toHaveBeenCalled();
    expect(screen.getByText('Введите № заявки или адрес')).toBeInTheDocument();
  });

  it('от 3 символов — после паузы один запрос, новые сверху, число найденных', async () => {
    renderSearch();
    fireEvent.change(searchBox(), { target: { value: 'Тес' } });
    fireEvent.change(searchBox(), { target: { value: 'Тестовая' } });
    expect(await screen.findByText('По № заявки или адресу · найдено 2')).toBeInTheDocument();
    expect(searchRequests).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchRequests).mock.calls[0][0]).toBe('Тестовая');
    const rows = screen.getAllByRole('button', { name: /№1000/ });
    expect(rows.map((row) => within(row).getByText(/^№/).textContent)).toEqual([
      '№100001',
      '№100002',
    ]);
    expect(
      within(rows[0]).getByText('Восток · 29.09 · окно 18–20 · Подключение'),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText('Выполнена')).toBeInTheDocument();
    expect(location()).toBe('/operator?q=%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%B0%D1%8F');
  });

  it('пусто — «Ничего не нашли»', async () => {
    vi.mocked(searchRequests).mockResolvedValue([]);
    renderSearch();
    fireEvent.change(searchBox(), { target: { value: '999999' } });
    expect(
      await screen.findByText('Ничего не нашли. Проверьте номер или адрес'),
    ).toBeInTheDocument();
  });

  it('ошибка — «Повторить» запрашивает снова', async () => {
    vi.mocked(searchRequests).mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'нет сети'));
    renderSearch();
    fireEvent.change(searchBox(), { target: { value: 'Тестовая' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('По № заявки или адресу · найдено 2')).toBeInTheDocument();
  });
});

describe('O-02 карточка и отмена', () => {
  async function openCard() {
    renderSearch();
    fireEvent.change(searchBox(), { target: { value: 'Тестовая' } });
    fireEvent.click(await screen.findByRole('button', { name: /№100001/ }));
    return screen.getByRole('heading', { name: '№100001' });
  }

  it('номер повторяется в разных днях — выделена и открыта только нажатая строка', async () => {
    const twin: BookingSearchItem = {
      ...planned,
      region_id: 'south_center',
      date: '2026-09-28',
      window: '20:00-22:00',
      address: 'Пырьева 16',
    };
    vi.mocked(searchRequests).mockResolvedValue([twin, planned]);
    renderSearch();
    fireEvent.change(searchBox(), { target: { value: '100001' } });
    const rows = await screen.findAllByRole('button', { name: /№100001/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);
    expect(location()).toContain('request=100001&region=south_center&date=2026-09-28');
    const pressed = screen
      .getAllByRole('button', { name: /№100001/ })
      .filter((row) => row.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(within(pressed[0]).getByText('Пырьева 16')).toBeInTheDocument();
    expect(screen.getByText('Югоцентр')).toBeInTheDocument();
    expect(screen.getByText('Пн, 28.09 · 20:00–22:00')).toBeInTheDocument();
  });

  it('клик по строке — карточка; полей ⏳ 9.2 нет — строк нет', async () => {
    await openCard();
    expect(location()).toContain('request=100001');
    expect(screen.getByText('Вт, 29.09 · 18:00–20:00')).toBeInTheDocument();
    expect(screen.getByText('Подключение · Заявка на подключение')).toBeInTheDocument();
    expect(screen.queryByText('Район')).not.toBeInTheDocument();
    expect(screen.queryByText('Гигабит')).not.toBeInTheDocument();
    expect(screen.queryByText('Инженер')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /№100001/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('поля ⏳ 9.2 пришли — район, гигабит, «не назначен»', async () => {
    vi.mocked(searchRequests).mockResolvedValue([
      { ...planned, district: 'Текстильщики', gigabit: true, engineer_name: null },
    ]);
    await openCard();
    expect(screen.getByText('Текстильщики')).toBeInTheDocument();
    expect(screen.getByText('да')).toBeInTheDocument();
    expect(screen.getByText('не назначен')).toBeInTheDocument();
  });

  it('отмена «Ошибка записи» → тело, тост по дате, карточка обновлена', async () => {
    vi.mocked(cancelBooking).mockResolvedValue({ status: 'cancelled' });
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(location()).toContain('cancel=1');
    expect(screen.getByText('Отменить заявку?')).toBeInTheDocument();
    // «Другое» — только при флаге cancelComment (⏳ 9.3)
    expect(screen.queryByText('Другое')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Клиент отказался' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Ошибка записи' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявку' }));
    expect(
      await screen.findByText('Заявка отменена. План на 29.09 пересчитан'),
    ).toBeInTheDocument();
    // день заявки — чтобы бэк не перепутал одинаковые номера в разных днях и регионах
    expect(cancelBooking).toHaveBeenCalledWith(
      '100001',
      { reason: 'booking_error' },
      expect.objectContaining({ regionId: 'east' }),
    );
    await waitFor(() => expect(screen.queryByText('Отменить заявку?')).not.toBeInTheDocument());
    expect(location()).not.toContain('cancel=1');
    await waitFor(() => expect(searchRequests).toHaveBeenCalledTimes(2));
  });

  it('message бэка важнее текста по дате', async () => {
    vi.mocked(cancelBooking).mockResolvedValue({ status: 'cancelled', message: 'Готово' });
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявку' }));
    expect(await screen.findByText('Готово')).toBeInTheDocument();
    expect(cancelBooking).toHaveBeenCalledWith(
      '100001',
      { reason: 'client_refused' },
      expect.objectContaining({ regionId: 'east' }),
    );
  });

  it('ILLEGAL_TRANSITION — тост с текстом бэка, поиск обновлён, без падения', async () => {
    vi.mocked(cancelBooking).mockRejectedValue(
      new ApiError(409, 'ILLEGAL_TRANSITION', 'Заявка уже отменена'),
    );
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявку' }));
    expect(await screen.findByText('Заявка уже отменена')).toBeInTheDocument();
    await waitFor(() => expect(searchRequests).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: '№100001' })).toBeInTheDocument();
  });

  it('«Назад» закрывает блок отмены', async () => {
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByText('Отменить заявку?')).not.toBeInTheDocument();
  });

  it('«Перенести» — на O-02.1 этой заявки', async () => {
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    expect(location()).toBe('/operator/reschedule/100001?region=east&date=2026-09-29');
  });

  it('✕ очищает поиск и выбор', async () => {
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(searchBox()).toHaveValue('');
    expect(location()).toBe('/operator');
    expect(screen.getByText('Выберите заявку слева')).toBeInTheDocument();
  });

  it('возврат из переноса без строки поиска — заявка по номеру', async () => {
    vi.mocked(searchRequests).mockResolvedValue([{ ...planned, request_id: '1000011' }, planned]);
    renderSearch('/operator?request=100001');
    expect(await screen.findByRole('heading', { name: '№100001' })).toBeInTheDocument();
    expect(searchRequests).toHaveBeenCalledWith('100001', expect.anything());
  });
});
