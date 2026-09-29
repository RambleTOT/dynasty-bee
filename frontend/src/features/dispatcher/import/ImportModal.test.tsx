import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegions, importBeeline, type ImportFiles } from '@/api/data';
import { getDay } from '@/api/days';
import { ApiError } from '@/api/errors';
import type { RegionInfo, ScenarioSummary } from '@/api/types';
import { forgetRegions } from '@/lib/regions';
import { ImportModal } from './ImportModal';

vi.mock('@/api/data', () => ({ getRegions: vi.fn(), importBeeline: vi.fn() }));
vi.mock('@/api/days', () => ({ getDay: vi.fn() }));

const region = (region_id: string, name: string, engineer_count: number): RegionInfo => ({
  region_id,
  name,
  office: { address: 'г. Москва', lat: 55.7, lon: 37.6 },
  request_count: 0,
  engineer_count,
  demo_available: false,
  has_control: false,
});

const REGIONS_RESPONSE = [
  region('east', 'Восток', 12),
  region('south_east', 'Юго-восток', 12),
  region('south_center', 'Югоцентр', 11),
];

// Файл заявок: заголовок, 3 заявки, пустые строки и адрес офиса (UTF-8 с BOM).
const REQUESTS_CSV = [
  'Заявка;Тип заявки BK;Адрес',
  '1;Подключение;ул. Первая, д. 1',
  '2;Дозаказ;ул. Вторая, д. 2',
  '3;Локальная заявка;ул. Третья, д. 3',
  ';;',
  'Адрес Офиса;ул. Офисная, д. 1;',
].join('\r\n');
const CONTROL_CSV = ['Заявка;Бригада', '1;Бригада 1', '2;Бригада 2', '3;'].join('\r\n');

const csvFile = (name: string, text: string) => new File(['﻿', text], name, { type: 'text/csv' });

function summary(regionId: string, requests: number, engineers: number): ScenarioSummary {
  return {
    scenario_id: `sc-${regionId}`,
    name: regionId,
    created_at: '2026-09-29T09:00:00Z',
    engineer_count: engineers,
    request_count: requests,
    skills: [],
    transports: [],
    region_id: regionId,
    date: '2026-09-29',
    source: 'csv',
    import_report: {
      rows_total: requests,
      rows_loaded: requests,
      rows_skipped: [],
      office: { address: 'г. Москва, ул. Офисная, д. 1', lat: 55.7, lon: 37.7 },
      geocoded_from_cache: requests,
      geocode_fallback: [],
      required_transport: { source: 'rule', car: 1, car_by_rule: 1 },
      dispatcher_assignments_loaded: 2,
      warnings: ['1 заявка без бригады в контрольном файле'],
    },
  };
}

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{pathname + search}</output>;
}

function renderModal(initialDate: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/dispatcher?modal=import']}
        future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/dispatcher"
            element={<ImportModal onClose={onClose} initialDate={initialDate} />}
          />
          <Route path="/dispatcher/day/:date" element={<p>DS-03</p>} />
        </Routes>
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate, onClose };
}

const regionCard = (name: string) => screen.getByRole('region', { name });
const pickFile = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
const uploadButton = () => screen.getByRole('button', { name: 'Загрузить' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  vi.mocked(getRegions).mockReset().mockResolvedValue(REGIONS_RESPONSE);
  vi.mocked(importBeeline).mockReset();
  // по умолчанию на дату у регионов дней нет
  vi.mocked(getDay)
    .mockReset()
    .mockImplementation(async (date) => ({ date, regions: [] }));
});

afterEach(() => {
  vi.useRealTimers();
  forgetRegions();
});

describe('DS-02 Загрузка CSV · шаг 1', () => {
  it('три карточки регионов с числом бригад; без файла заявок «Загрузить» неактивна', async () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Загрузка CSV' });
    expect(
      within(dialog).getByText('Шаг 1 из 2 · файлы. Можно загрузить от 1 до 3 регионов'),
    ).toBeInTheDocument();
    expect(await within(regionCard('Восток')).findByText('12 бригад')).toBeInTheDocument();
    expect(within(regionCard('Юго-восток')).getByText('12 бригад')).toBeInTheDocument();
    expect(within(regionCard('Югоцентр')).getByText('11 бригад')).toBeInTheDocument();
    expect(
      within(regionCard('Восток')).getByText('Перетащите файл или выберите'),
    ).toBeInTheDocument();
    expect(
      within(regionCard('Восток')).getByText('Нужен для сравнения с реальным диспетчером'),
    ).toBeInTheDocument();
    expect(uploadButton()).toBeDisabled();
    // «Другой участок» — только с §14 (FEATURES.anyRegion)
    expect(screen.queryByRole('region', { name: 'Другой участок' })).not.toBeInTheDocument();
  });

  it('бэк выложил §14 (в GET /regions есть builtin) — «Другой участок» появляется сам', async () => {
    vi.mocked(getRegions).mockResolvedValue(
      REGIONS_RESPONSE.map((item) => ({ ...item, builtin: true }) as RegionInfo),
    );
    renderModal();
    expect(await screen.findByRole('region', { name: 'Другой участок' })).toBeInTheDocument();
  });

  it('выбранный файл: имя, строки на клиенте и размер; ✕ убирает', async () => {
    renderModal();
    pickFile('Файл заявок (.csv) · Восток', csvFile('vostok.csv', REQUESTS_CSV));
    const card = regionCard('Восток');
    expect(within(card).getByText('vostok.csv')).toBeInTheDocument();
    expect(await within(card).findByText('3 строки · 1 КБ')).toBeInTheDocument();
    expect(uploadButton()).toBeEnabled();

    pickFile('Контрольное распределение · Восток', csvFile('vostok_control.csv', CONTROL_CSV));
    expect(
      await within(card).findByText('Контрольное распределение · 3 строки'),
    ).toBeInTheDocument();

    fireEvent.click(within(card).getAllByRole('button', { name: 'Убрать файл' })[0]);
    expect(within(card).queryByText('vostok.csv')).not.toBeInTheDocument();
    expect(uploadButton()).toBeDisabled();
  });

  it('файл можно перетащить в зону', async () => {
    renderModal();
    const zone = within(regionCard('Югоцентр')).getByText('Файл заявок (.csv)').closest('div');
    fireEvent.drop(zone as HTMLElement, {
      dataTransfer: { files: [csvFile('yugocentr.csv', REQUESTS_CSV)] },
    });
    expect(await within(regionCard('Югоцентр')).findByText('3 строки · 1 КБ')).toBeInTheDocument();
  });

  it('«Отмена» закрывает', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DS-02 Загрузка CSV · дата плана', () => {
  it('по умолчанию — сегодня; с пустого дня — его дата, импорт и «Открыть день» — на неё', async () => {
    vi.mocked(importBeeline).mockResolvedValue({ ...summary('east', 3, 12), date: '2026-10-05' });
    renderModal('2026-10-05');
    const field = screen.getByLabelText('Дата плана');
    expect(field).toHaveValue('2026-10-05');
    expect(screen.getByText('Заявки из файлов попадут на 5 октября')).toBeInTheDocument();

    const requests = csvFile('vostok.csv', REQUESTS_CSV);
    pickFile('Файл заявок (.csv) · Восток', requests);
    await waitFor(() => expect(uploadButton()).toBeEnabled());
    fireEvent.click(uploadButton());
    const dialog = await screen.findByRole('dialog', { name: 'Отчёт импорта' });
    expect(importBeeline).toHaveBeenCalledWith({
      requestsFile: requests,
      controlFile: null,
      regionId: 'east',
      date: '2026-10-05',
    });
    expect(within(dialog).getByText('Шаг 2 из 2 · план на 05.10.2026')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Открыть день' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/dispatcher/day/2026-10-05?region=east');
  });

  it('дату можно сменить; прошедший день — ошибка, «Загрузить» неактивна', async () => {
    renderModal();
    const field = screen.getByLabelText('Дата плана');
    expect(field).toHaveValue('2026-09-29');
    pickFile('Файл заявок (.csv) · Восток', csvFile('vostok.csv', REQUESTS_CSV));

    fireEvent.change(field, { target: { value: '2026-09-20' } });
    expect(screen.getByText('Выберите сегодняшний или будущий день')).toBeInTheDocument();
    expect(uploadButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: '2026-10-12' } });
    expect(screen.getByText('Заявки из файлов попадут на 12 октября')).toBeInTheDocument();
    await waitFor(() => expect(uploadButton()).toBeEnabled());
  });

  it('на дату уже загружен CSV — предупреждение и подтверждение замены; записи оператора — нельзя', async () => {
    const days: Record<string, string> = {
      east: 'csv',
      south_east: 'demo',
      south_center: 'booking',
    };
    vi.mocked(getDay).mockImplementation(async (date, regionId) => ({
      date,
      regions:
        date === '2026-10-05' && days[regionId]
          ? [{ region_id: regionId, scenario_id: `sc-${regionId}`, source: days[regionId] }]
          : [],
    }));
    vi.mocked(importBeeline).mockResolvedValue({ ...summary('east', 3, 12), date: '2026-10-05' });
    renderModal('2026-10-05');
    const east = regionCard('Восток');
    expect(
      await within(east).findByText(
        /На 5 октября у региона уже загружен CSV. Новый файл заменит его/,
      ),
    ).toBeInTheDocument();
    expect(within(east).getByLabelText('Файл заявок (.csv) · Восток')).toBeEnabled();
    const center = regionCard('Югоцентр');
    expect(within(center).getByText(/уже есть записи оператора/)).toBeInTheDocument();
    expect(within(center).getByLabelText('Файл заявок (.csv) · Югоцентр')).toBeDisabled();
    expect(within(regionCard('Юго-восток')).queryByText(/На 5 октября/)).toBeNull();

    const requests = csvFile('vostok.csv', REQUESTS_CSV);
    pickFile('Файл заявок (.csv) · Восток', requests);
    await waitFor(() => expect(uploadButton()).toBeEnabled());
    fireEvent.click(uploadButton());
    const confirm = screen.getByRole('dialog', { name: 'Заменить загруженный CSV?' });
    expect(within(confirm).getByText(/уже загружен CSV: Восток/)).toBeInTheDocument();
    expect(importBeeline).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Заменить и загрузить' }));
    await screen.findByRole('dialog', { name: 'Отчёт импорта' });
    expect(importBeeline).toHaveBeenCalledWith(
      expect.objectContaining({ regionId: 'east', date: '2026-10-05', requestsFile: requests }),
    );
  });

  it('дата из адреса в прошлом — берём сегодня', () => {
    renderModal('2026-09-01');
    expect(screen.getByLabelText('Дата плана')).toHaveValue('2026-09-29');
  });
});

describe('DS-02 Загрузка CSV · шаг 2', () => {
  it('регионы грузятся параллельно на сегодня; отчёт, ошибка региона, итог, «Открыть день»', async () => {
    vi.mocked(importBeeline).mockImplementation(({ regionId }: ImportFiles) =>
      regionId === 'east'
        ? Promise.resolve(summary('east', 3, 12))
        : Promise.reject(
            new ApiError(
              422,
              'BAD_CSV',
              'В файле нет колонок: Тип заявки BK, Адрес. Проверьте, что это выгрузка Билайна',
            ),
          ),
    );
    const { invalidate } = renderModal();
    const requests = csvFile('vostok.csv', REQUESTS_CSV);
    const control = csvFile('vostok_control.csv', CONTROL_CSV);
    const broken = csvFile('yugocentr.csv', 'не csv');
    pickFile('Файл заявок (.csv) · Восток', requests);
    pickFile('Контрольное распределение · Восток', control);
    pickFile('Файл заявок (.csv) · Югоцентр', broken);
    // контрольный файл без файла заявок не грузим
    pickFile('Контрольное распределение · Юго-восток', csvFile('yv_control.csv', CONTROL_CSV));

    await waitFor(() => expect(uploadButton()).toBeEnabled());
    fireEvent.click(uploadButton());
    const dialog = await screen.findByRole('dialog', { name: 'Отчёт импорта' });

    expect(importBeeline).toHaveBeenCalledTimes(2);
    expect(importBeeline).toHaveBeenCalledWith({
      requestsFile: requests,
      controlFile: control,
      regionId: 'east',
      date: '2026-09-29',
    });
    expect(importBeeline).toHaveBeenCalledWith({
      requestsFile: broken,
      controlFile: null,
      regionId: 'south_center',
      date: '2026-09-29',
    });

    expect(within(dialog).getByText('Шаг 2 из 2 · план на 29.09.2026')).toBeInTheDocument();
    const east = within(dialog).getByRole('region', { name: 'Восток' });
    expect(within(east).getByText('Есть замечания')).toBeInTheDocument();
    for (const text of [
      'Загружено 3 из 3 заявок',
      'Офис: г. Москва, ул. Офисная, д. 1',
      'Автомобиль нужен 1 заявке (заполнено правилом: кабель, гигабит, авария)',
      'Назначений реального диспетчера: 2 из 3',
      '1 заявка без бригады в контрольном файле',
    ]) {
      expect(within(east).getByText(text)).toBeInTheDocument();
    }
    const failed = within(dialog).getByRole('region', { name: 'Югоцентр' });
    expect(within(failed).getByText('Ошибка')).toBeInTheDocument();
    expect(
      within(failed).getByText(
        'В файле нет колонок: Тип заявки BK, Адрес. Проверьте, что это выгрузка Билайна',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Всего 3 заявки · 1 регион · 12 бригад')).toBeInTheDocument();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendar'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['days'] });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Открыть день' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/dispatcher/day/2026-09-29?region=east');
  });

  it('без контрольного файла — «Есть замечания», предупреждение бэка о бригадах не дублируется', async () => {
    vi.mocked(importBeeline).mockResolvedValue(summary('south_east', 3, 12));
    renderModal();
    pickFile('Файл заявок (.csv) · Юго-восток', csvFile('yv.csv', REQUESTS_CSV));
    await within(regionCard('Юго-восток')).findByText('3 строки · 1 КБ');
    await waitFor(() => expect(uploadButton()).toBeEnabled());
    fireEvent.click(uploadButton());

    const dialog = await screen.findByRole('dialog', { name: 'Отчёт импорта' });
    const card = within(dialog).getByRole('region', { name: 'Юго-восток' });
    expect(within(card).getByText('Есть замечания')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»',
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/без бригады/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Назначений реального диспетчера/)).not.toBeInTheDocument();
  });

  it('ни один регион не загрузился: без итога, «Открыть день» неактивна, кэш не трогаем; «Назад» — к файлам', async () => {
    vi.mocked(importBeeline).mockRejectedValue(
      new ApiError(409, 'DATE_HAS_BOOKINGS', 'На эту дату уже есть записи оператора'),
    );
    const { invalidate } = renderModal();
    pickFile('Файл заявок (.csv) · Восток', csvFile('vostok.csv', REQUESTS_CSV));
    await waitFor(() => expect(uploadButton()).toBeEnabled());
    fireEvent.click(uploadButton());

    const dialog = await screen.findByRole('dialog', { name: 'Отчёт импорта' });
    expect(within(dialog).getByText('На эту дату уже есть записи оператора')).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Всего/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Открыть день' })).toBeDisabled();
    expect(invalidate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Назад' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Загрузка CSV' })).toBeInTheDocument(),
    );
    expect(within(regionCard('Восток')).getByText('vostok.csv')).toBeInTheDocument();
  });
});
