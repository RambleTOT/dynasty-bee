import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSearchItem } from '@/adapters/booking';
import { getSlots, rescheduleBooking, searchRequests } from '@/api/booking';
import { ApiError } from '@/api/errors';
import type { BookingSearchItem, BookingSlotsResponse } from '@/api/types';
import { dismissAll } from '@/lib/notify';
import type { RescheduleState } from '../navigation';
import { renderScreen } from '../testUtils';
import ReschedulePage from './ReschedulePage';

vi.mock('@/api/booking', () => ({
  searchRequests: vi.fn(),
  getSlots: vi.fn(),
  rescheduleBooking: vi.fn(),
}));

const row: BookingSearchItem = {
  request_id: '100001',
  region_id: 'east',
  date: '2026-09-30',
  window: '18:00-20:00',
  address: 'ул. Тестовая, д. 1, кв. 2',
  type_bk: 'Подключение',
  type_hd: 'Заявка на подключение',
  status: 'planned',
};

function slotsResponse(date: string, busy: string[] = []): BookingSlotsResponse {
  return {
    region_id: 'east',
    date,
    required_skill: 'installation',
    duration_minutes: 70,
    slots: ['10:00-12:00', '14:00-16:00', '18:00-20:00'].map((window) => ({
      window,
      available: !busy.includes(window),
    })),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z'));
  vi.mocked(searchRequests).mockResolvedValue([{ ...row, request_id: '1000011' }, row]);
  vi.mocked(getSlots).mockImplementation(async (query) => slotsResponse(query.date));
});

afterEach(() => {
  act(() => dismissAll());
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderReschedule(url: Parameters<typeof renderScreen>[1]['url']) {
  return renderScreen(<ReschedulePage />, { path: '/operator/reschedule/:id', url });
}

const location = () => screen.getByTestId('location').textContent;

describe('O-02.1 перенос', () => {
  it('прямой заход: заявка по номеру, дата заявки по умолчанию, окна по её полям', async () => {
    renderReschedule('/operator/reschedule/100001');
    expect(await screen.findByText('Перенос заявки №100001')).toBeInTheDocument();
    expect(searchRequests).toHaveBeenCalledWith('100001', expect.anything());
    expect(screen.getByText('Сейчас: 30.09, 18–20')).toBeInTheDocument();
    expect(screen.getByText('Ср, 30.09 · 18:00–20:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ср, 30.09' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    await screen.findByRole('button', { name: /14–16/ });
    expect(getSlots).toHaveBeenCalledWith(
      {
        region_id: 'east',
        date: '2026-09-30',
        type_bk: 'Подключение',
        type_hd: 'Заявка на подключение',
        address: 'ул. Тестовая, д. 1, кв. 2',
        gigabit: false,
        required_transport: undefined,
      },
      expect.anything(),
    );
  });

  it('номер повторяется в разных днях — берём день из адреса; регион — в сводке', async () => {
    vi.mocked(searchRequests).mockResolvedValue([
      { ...row, region_id: 'south_center', date: '2026-09-29', window: '14:00-16:00' },
      row,
    ]);
    renderReschedule('/operator/reschedule/100001?region=east&date=2026-09-30');
    expect(await screen.findByText('Сейчас: 30.09, 18–20')).toBeInTheDocument();
    expect(screen.getByText('Восток')).toBeInTheDocument();
  });

  it('заявка через два месяца: лента — с её датой и месяцем; календарь — любой день', async () => {
    const state: RescheduleState = {
      item: normalizeSearchItem({ ...row, date: '2026-11-27', window: '14:00-16:00' }),
      q: '',
    };
    renderReschedule({ pathname: '/operator/reschedule/100001', state });
    expect(screen.getByRole('button', { name: 'Пт, 27.11' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Ноябрь')).toBeInTheDocument();
    expect(screen.getByText('Сейчас: 27.11, 14–16')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату в календаре' }));
    const calendar = screen.getByRole('dialog', { name: 'Выберите дату' });
    expect(within(calendar).getByText('Ноябрь 2026')).toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: 'Следующий месяц' }));
    fireEvent.click(within(calendar).getByRole('button', { name: 'Пн, 7 декабря' }));
    expect(screen.queryByRole('dialog', { name: 'Выберите дату' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пн, 07.12' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Декабрь')).toBeInTheDocument();
    await waitFor(() =>
      expect(getSlots).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-12-07' }),
        expect.anything(),
      ),
    );
  });

  it('в календаре прошедшие дни не выбрать, назад раньше текущего месяца не листается', () => {
    const state: RescheduleState = { item: normalizeSearchItem(row), q: '' };
    renderReschedule({ pathname: '/operator/reschedule/100001', state });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату в календаре' }));
    const calendar = screen.getByRole('dialog', { name: 'Выберите дату' });
    expect(within(calendar).getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
    expect(within(calendar).getByRole('button', { name: 'Вс, 27 сентября' })).toBeDisabled();
    expect(within(calendar).getByRole('button', { name: 'Пн, 28 сентября' })).toBeEnabled();
  });

  it('заявки с таким номером нет — в поиск с этим номером', async () => {
    vi.mocked(searchRequests).mockResolvedValue([{ ...row, request_id: '1000011' }]);
    renderReschedule('/operator/reschedule/100001');
    await waitFor(() => expect(location()).toBe('/operator?q=100001'));
  });

  it('из поиска: без второго запроса; прошедшая дата — по умолчанию завтра', async () => {
    const state: RescheduleState = {
      item: normalizeSearchItem({ ...row, date: '2026-09-20', gigabit: true }),
      q: 'Тестовая',
    };
    renderReschedule({ pathname: '/operator/reschedule/100001', state });
    expect(screen.getByText('Перенос заявки №100001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вт, 29.09' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await screen.findByRole('button', { name: /14–16/ });
    expect(searchRequests).not.toHaveBeenCalled();
    expect(getSlots).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-09-29', gigabit: true }),
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(location()).toBe(
      '/operator?q=%D0%A2%D0%B5%D1%81%D1%82%D0%BE%D0%B2%D0%B0%D1%8F&request=100001&region=east&date=2026-09-20',
    );
  });

  it('«Перенести на …» → тело, возврат в поиск к заявке, тост', async () => {
    vi.mocked(rescheduleBooking).mockResolvedValue({ status: 'rescheduled' });
    renderReschedule('/operator/reschedule/100001');
    expect(await screen.findByRole('button', { name: 'Выберите окно' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на 14:00–16:00' }));
    expect(
      await screen.findByText('Заявка №100001 перенесена на 30.09, 14–16'),
    ).toBeInTheDocument();
    expect(rescheduleBooking).toHaveBeenCalledWith(
      '100001',
      { new_date: '2026-09-30', new_window: '14:00-16:00' },
      { regionId: 'east', date: '2026-09-30' },
    );
    // в поиск — к перенесённой заявке: её день теперь новый
    expect(location()).toBe('/operator?request=100001&region=east&date=2026-09-30');
  });

  it('новый номер после переноса (⏳ 9.4) — поиск по новому номеру', async () => {
    vi.mocked(rescheduleBooking).mockResolvedValue({
      status: 'rescheduled',
      request_id: '100777',
      date: '2026-10-01',
      window: '10:00-12:00',
    });
    const state: RescheduleState = { item: normalizeSearchItem(row), q: 'Тестовая' };
    renderReschedule({ pathname: '/operator/reschedule/100001', state });
    fireEvent.click(await screen.findByRole('button', { name: /10–12/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на 10:00–12:00' }));
    expect(
      await screen.findByText('Заявка №100001 перенесена на 01.10, 10–12'),
    ).toBeInTheDocument();
    expect(location()).toBe('/operator?request=100777&region=east&date=2026-10-01');
  });

  it('SLOT_TAKEN — плашка, выбор снят', async () => {
    vi.mocked(rescheduleBooking).mockRejectedValue(
      new ApiError(409, 'SLOT_TAKEN', 'Нет подходящего инженера'),
    );
    renderReschedule('/operator/reschedule/100001');
    fireEvent.click(await screen.findByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на 14:00–16:00' }));
    expect(
      await screen.findByText('Это окно только что заняли. Выберите другое'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выберите окно' })).toBeDisabled();
    expect(location()).toBe('/operator/reschedule/100001');
  });

  it('ILLEGAL_TRANSITION — тост с текстом бэка и возврат в поиск', async () => {
    vi.mocked(rescheduleBooking).mockRejectedValue(
      new ApiError(409, 'ILLEGAL_TRANSITION', 'Заявка уже выполнена — перенести нельзя'),
    );
    renderReschedule('/operator/reschedule/100001');
    fireEvent.click(await screen.findByRole('button', { name: /14–16/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на 14:00–16:00' }));
    expect(await screen.findByText('Заявка уже выполнена — перенести нельзя')).toBeInTheDocument();
    expect(location()).toBe('/operator?request=100001&region=east&date=2026-09-30');
  });
});
