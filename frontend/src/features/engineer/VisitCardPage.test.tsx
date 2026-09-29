import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, getMyRoute, postAction } from '@/api/engineer';
import type { EngineerMeDay, EngineerRoute } from '@/api/types';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import { hideDoneToast } from './doneToastStore';
import EngineerApp from './EngineerApp';
import VisitCardPage from './VisitCardPage';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

type ActionResult = Awaited<ReturnType<typeof postAction>>;

/** №…1402 в пути (текущая), №…6318 следующая, №…0003 выполнена, №…0002 ждёт решения. */
function day(extra: Partial<EngineerMeDay> = {}): EngineerMeDay {
  return dayRaw(
    [
      visitRaw('10000003', 3, 'done'),
      visitRaw('10000002', 2, 'cancel_pending'),
      visitRaw('305871402', 4, 'en_route'),
      visitRaw('305866318', 5, 'planned', { flags: ['changed'] }),
    ],
    { active_request_id: '305871402', summary: { total: 9 }, ...extra },
  );
}

const route: EngineerRoute = {
  transport: 'car',
  start: { lat: 55.7098, lon: 37.7805, label: 'ул. Окская' },
  points: [
    { request_id: '305871402', sequence: 4, lat: 55.7071, lon: 37.7612 },
    { request_id: '305866318', sequence: 5, lat: 55.7133, lon: 37.7481 },
  ],
  geometry: { type: 'LineString', coordinates: [] },
};

const renderCard = (id: string) =>
  renderEngineer({ home: <EngineerApp />, card: <VisitCardPage /> }, `/engineer/request/${id}`);

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
  vi.mocked(getMyRoute).mockReset();
  vi.mocked(postAction).mockReset();
  vi.mocked(getMyRoute).mockResolvedValue(route);
});

afterEach(() => {
  act(() => hideDoneToast());
});

describe('E-03.1 карточка следующей заявки', () => {
  it('подробности, «Почему это вам», «Начать можно после…» и маршрут в Яндекс Картах', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderCard('305866318');

    expect(await screen.findByText('СЛЕДУЮЩАЯ · 5 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Заявка 5' })).toBeInTheDocument();
    expect(screen.getByText('Запланирована')).toBeInTheDocument();
    expect(screen.getByText('ул.Окская, д. 5, кв. 13')).toBeInTheDocument();

    const rows = screen
      .getAllByRole('term')
      .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
    expect(rows).toEqual([
      'Номер: №305866318',
      'Тип: Подключение',
      'Район: Кузьминки',
      'Окно: 14:00–16:00',
      'Приезд · начало: 14:30 · 14:40',
      'Длительность: 70 мин',
      'Технология: FTTB',
    ]);
    expect(screen.getByText('Почему это вам:').parentElement).toHaveTextContent(
      'Почему это вам: навык — подключения, окно 14–16',
    );
    expect(
      screen.getByText('Начать можно после завершения текущей заявки №…1402'),
    ).toBeInTheDocument();

    const link = await screen.findByRole('link', { name: 'Маршрут в Яндекс Картах' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).toHaveAttribute(
      'href',
      'https://yandex.ru/maps/?rtext=55.709800,37.780500~55.707100,37.761200~55.713300,37.748100&rtt=auto',
    );
    expect(screen.queryByRole('button', { name: 'Отправиться в путь' })).toBeNull();
  });

  it('/me/route пуст — ссылка по координатам визитов', async () => {
    const raw = day();
    raw.visits = raw.visits?.map((visit) =>
      visit.request_id === '10000003'
        ? { ...visit, lat: 55.7, lon: 37.7 }
        : visit.request_id === '305871402'
          ? { ...visit, lat: 55.71, lon: 37.71 }
          : visit.request_id === '305866318'
            ? { ...visit, lat: 55.72, lon: 37.72 }
            : visit,
    ) as EngineerMeDay['visits'];
    vi.mocked(getMyDay).mockResolvedValue(raw);
    vi.mocked(getMyRoute).mockResolvedValue({ transport: 'walk', points: [], geometry: null });
    renderCard('305866318');
    const link = await screen.findByRole('link', { name: 'Маршрут в Яндекс Картах' });
    expect(link).toHaveAttribute(
      'href',
      'https://yandex.ru/maps/?rtext=55.700000,37.700000~55.710000,37.710000~55.720000,37.720000&rtt=auto',
    );
  });

  it('открытие снимает «Изменено» локально: в карточке флаг ещё виден, в списке — нет', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderEngineer({ home: <EngineerApp />, card: <VisitCardPage /> });

    const next = await screen.findByRole('region', { name: 'Далее по маршруту' });
    const row = within(next)
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/engineer/request/305866318') as HTMLElement;
    expect(within(row).getByText('Изменено')).toBeInTheDocument();

    fireEvent.click(row);
    expect(await screen.findByText('СЛЕДУЮЩАЯ · 5 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByText('Изменено')).toBeInTheDocument();
    expect(window.localStorage.getItem('seen_changed_305866318')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    const list = await screen.findByRole('region', { name: 'Далее по маршруту' });
    expect(within(list).queryByText('Изменено')).toBeNull();
  });
});

describe('E-05 карточка текущей заявки', () => {
  it('«ТЕКУЩАЯ», панель статуса внизу; «Выполнить задачу» ведёт к списку', async () => {
    const raw = day();
    raw.visits = raw.visits?.map((visit) =>
      visit.request_id === '305871402' ? { ...visit, status: 'in_progress' } : visit,
    );
    vi.mocked(getMyDay).mockResolvedValue(raw);
    vi.mocked(postAction).mockResolvedValue({
      engineer_id: 'E01',
      action: 'complete',
      status: 'ok',
    } as ActionResult);
    renderCard('305871402');

    expect(await screen.findByText('ТЕКУЩАЯ · 4 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прервать' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить задачу' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({ action: 'complete', request_id: '305871402' }),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/engineer$/));
  });

  it('«Прервать» из карточки — шторка для этой заявки', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderCard('305871402');
    fireEvent.click(await screen.findByRole('button', { name: 'Прервать' }));
    const sheet = await screen.findByRole('dialog', { name: 'Прервать выполнение' });
    expect(within(sheet).getByText('№305871402 · ул.Окская, д. 4')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/engineer/request/305871402?sheet=interrupt',
    );
  });
});

describe('карточка закрытой и ждущей заявки', () => {
  it('выполненная — без кнопок', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderCard('10000003');
    expect(await screen.findByText('ЗАВЕРШЁННАЯ · 3 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByText('Выполнена')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Прервать|Отправиться|Выполнить/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Маршрут в Яндекс Картах' })).toBeNull();
  });

  it('ждёт решения диспетчера', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderCard('10000002');
    expect(await screen.findByText('ЖДЁТ РЕШЕНИЯ · 2 ИЗ 9')).toBeInTheDocument();
    expect(
      screen.getByText('Ждёт решения диспетчера. Можно ехать к следующей заявке'),
    ).toBeInTheDocument();
  });

  it('заявки нет в дне — «Заявка не найдена» и возврат к списку', async () => {
    vi.mocked(getMyDay).mockResolvedValue(day());
    renderCard('404');
    expect(await screen.findByText('Заявка не найдена')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'К списку заявок' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/engineer$/));
  });

  it('гигабит — строкой «да»', async () => {
    const raw = day();
    raw.visits = raw.visits?.map((visit) =>
      visit.request_id === '305866318' ? { ...visit, gigabit: true } : visit,
    );
    vi.mocked(getMyDay).mockResolvedValue(raw);
    renderCard('305866318');
    expect(await screen.findByText('Гигабит')).toBeInTheDocument();
    expect(screen.getByText('да')).toBeInTheDocument();
  });
});
