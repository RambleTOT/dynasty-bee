import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegions, importBeeline, type ImportFiles } from '@/api/data';
import { getDay } from '@/api/days';
import { ApiError } from '@/api/errors';
import { geocodeAddress } from '@/api/geocoder';
import { createRegion, getRegionRoster, patchRegion, putRegionRoster } from '@/api/regions';
import type { RegionInfo, ScenarioSummary } from '@/api/types';
import { readCsvText } from '@/lib/csv';
import { forgetRegions } from '@/lib/regions';
import { ImportModal } from '../ImportModal';

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, FEATURES: { ...actual.FEATURES, anyRegion: true } };
});
vi.mock('@/api/data', () => ({ getRegions: vi.fn(), importBeeline: vi.fn() }));
vi.mock('@/api/days', () => ({ getDay: vi.fn() }));
vi.mock('@/api/regions', () => ({
  createRegion: vi.fn(),
  patchRegion: vi.fn(),
  getRegionRoster: vi.fn(),
  putRegionRoster: vi.fn(),
}));
vi.mock('@/api/geocoder', () => ({
  addressSuggestEnabled: true,
  suggestAddresses: vi.fn(async () => null),
  reverseAddress: vi.fn(async () => null),
  geocodeAddress: vi.fn(),
}));

const region = (region_id: string, name: string, extra: Partial<RegionInfo> = {}): RegionInfo => ({
  region_id,
  name,
  office: { address: 'г. Москва', lat: 55.7, lon: 37.6 },
  request_count: 0,
  engineer_count: 12,
  demo_available: true,
  has_control: true,
  builtin: true,
  ...extra,
});

const CASE_REGIONS = [
  region('east', 'Восток'),
  region('south_east', 'Юго-восток'),
  region('south_center', 'Югоцентр'),
];

// Файл другого участка: запятая, свои названия колонок, окно одной колонкой, часть координат.
const FOREIGN_CSV = [
  '№ заявки,Вид работ,Интервал,Адрес клиента,Широта,Долгота',
  'A-1,Подключение,10:00-12:00,"Химки, ул. Кирова, д. 5",55.9,37.44',
  'A-2,Ремонт ТВ,12-14,"Химки, ул. Ленина, д. 7",,',
  'A-3,Ремонт ТВ,с 14 до 16,"Химки, ул. Мира, д. 1",,',
  'A-4,Авария,,"Химки, ул. Мира, д. 9",,',
  'Адрес офиса: Химки, ул. Молодёжная, д. 4',
].join('\n');
const FOREIGN_CONTROL = [
  '№ заявки;Исполнитель',
  'A-1;Иванов',
  'A-2;Иванов',
  'A-3;Петров',
  'A-4;Петров',
].join('\n');

const csvFile = (name: string, text: string) => new File([text], name, { type: 'text/csv' });

/** Ответ Photon: улица и дом в точке. */
const photon = (street: string, house: string, lat: number, lon: number) => ({
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { type: 'house', street, housenumber: house },
    },
  ],
});

function summary(regionId: string): ScenarioSummary {
  return {
    scenario_id: `sc-${regionId}`,
    name: regionId,
    created_at: '2026-09-29T09:00:00Z',
    engineer_count: 2,
    request_count: 4,
    skills: [],
    transports: [],
    region_id: regionId,
    date: '2026-09-29',
    source: 'csv',
    import_report: {
      rows_total: 4,
      rows_loaded: 4,
      rows_skipped: [],
      office: { address: 'Химки, ул. Молодёжная, д. 4', lat: 55.89, lon: 37.43 },
      coords_from_file: 3,
      geocoded: 0,
      geocode_fallback: ['Химки, ул. Мира, д. 9'],
      dispatcher_assignments_loaded: 4,
      warnings: [],
    },
  };
}

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{pathname + search}</output>;
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/dispatcher?modal=import']}
        future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/dispatcher" element={<ImportModal onClose={vi.fn()} />} />
          <Route path="/dispatcher/day/:date" element={<p>DS-03</p>} />
        </Routes>
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pickFile = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
const subtitle = (text: string) => screen.findByText(new RegExp(`^Шаг ${text}`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  vi.mocked(getRegions).mockReset().mockResolvedValue(CASE_REGIONS);
  vi.mocked(getDay)
    .mockReset()
    .mockImplementation(async (date) => ({ date, regions: [] }));
  vi.mocked(importBeeline)
    .mockReset()
    .mockImplementation(async ({ regionId }) => summary(regionId));
  vi.mocked(createRegion)
    .mockReset()
    .mockImplementation(async (body) =>
      region('r-north', body.name, { builtin: false, office: body.office }),
    );
  vi.mocked(patchRegion).mockReset();
  vi.mocked(getRegionRoster).mockReset().mockResolvedValue([]);
  vi.mocked(putRegionRoster)
    .mockReset()
    .mockImplementation(async (_id, roster) => roster);
  vi.mocked(geocodeAddress)
    .mockReset()
    .mockImplementation(async (query) => {
      if (query.includes('Молод')) return photon('Молодёжная улица', '4', 55.89, 37.43);
      if (query.includes('Ленина')) return photon('улица Ленина', '7', 55.88, 37.44);
      if (query.includes('Мира, 1')) return photon('улица Мира', '1', 55.9, 37.45);
      return { features: [] };
    });
});

afterEach(() => {
  vi.useRealTimers();
  forgetRegions();
});

// сквозные сценарии мастера длинные: в общем прогоне под нагрузкой 5 с по умолчанию не хватает
vi.setConfig({ testTimeout: 20_000 });

describe('«Другой участок» (§14)', () => {
  it('новый участок: файлы → колонки → нормативы → бригады → точки → участок, ростер и CSV Билайна', async () => {
    renderModal();
    const card = await screen.findByRole('region', { name: 'Другой участок' });
    fireEvent.click(within(card).getByRole('button', { name: 'Настроить загрузку' }));

    // шаг 1: название, офис (из файла, точка — по адресу), файлы
    expect(await subtitle('1 из 5 · участок и файлы')).toBeInTheDocument();
    next();
    expect(await screen.findByText('Введите название')).toBeInTheDocument();
    expect(screen.getByText('Выберите файл заявок')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Название участка'), { target: { value: 'Восток' } });
    expect(
      screen.getByText('Участок «Восток» уже есть — выберите его в списке'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название участка'), { target: { value: 'Север' } });
    pickFile('Файл заявок (.csv)', csvFile('himki.csv', FOREIGN_CSV));
    pickFile(
      'Контрольное распределение — по желанию',
      csvFile('himki_control.csv', FOREIGN_CONTROL),
    );
    expect(await screen.findByText('4 строки · 1 КБ')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Адрес офиса' })).toHaveValue(
      'Химки, ул. Молодёжная, д. 4',
    );
    expect(await screen.findByText('Точка по адресу: Молодёжная улица, 4')).toBeInTheDocument();
    next();

    // шаг 2: колонки угаданы по названиям, окно — одной колонкой, бригады — по номеру заявки
    expect(await subtitle('2 из 5 · колонки файла')).toBeInTheDocument();
    const requests = screen.getByRole('region', { name: 'Файл заявок' });
    expect(within(requests).getByText('UTF-8 · разделитель «,» · 4 строки')).toBeInTheDocument();
    expect(
      within(requests).getByRole('combobox', { name: 'Окно одной колонкой' }),
    ).toHaveDisplayValue('Интервал');
    expect(
      within(requests).getByText('Нужные колонки нашли — загрузим 4 заявки'),
    ).toBeInTheDocument();
    // необязательные поля без колонки свёрнуты, неиспользуемых колонок файла нет
    expect(within(requests).queryByRole('combobox', { name: 'Район' })).not.toBeInTheDocument();
    fireEvent.click(
      within(requests).getByRole('button', { name: 'Ещё 6 полей — если они есть в файле' }),
    );
    expect(within(requests).getByRole('combobox', { name: 'Район' })).toBeInTheDocument();
    expect(within(requests).getByText('Окна нет — весь день смены: строка 5')).toBeInTheDocument();
    expect(
      screen.getByText('Бригада есть у 4 из 4 заявок: сопоставили по номеру заявки'),
    ).toBeInTheDocument();
    next();

    // шаг 3: типы из файла — Билайн, новый тип, угаданная авария
    expect(await subtitle('3 из 5 · нормативы')).toBeInTheDocument();
    expect(screen.getByText('как у Билайна')).toBeInTheDocument();
    expect(screen.getAllByText('новый тип')).toHaveLength(2);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Минут · Ремонт ТВ' }), {
      target: { value: '45' },
    });
    expect(screen.getByText('изменён')).toBeInTheDocument();
    next();

    // шаг 4: бригады из контрольного файла, навыки — по их заявкам
    expect(await subtitle('4 из 5 · бригады')).toBeInTheDocument();
    const names = screen.getAllByRole('textbox', { name: 'Имя бригады' });
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual(['Иванов', 'Петров']);
    const petrov = screen.getByRole('group', { name: 'Навыки · Петров' });
    expect(within(petrov).getByRole('checkbox', { name: 'Лок.' })).toBeChecked();
    expect(within(petrov).getByRole('checkbox', { name: 'Авария' })).toBeChecked();
    expect(within(petrov).getByRole('checkbox', { name: 'Подкл.' })).not.toBeChecked();
    next();

    // шаг 5: координаты из файла — у одной; остальные ищем кнопкой
    expect(await subtitle('5 из 5 · точки заявок')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Найти точки' }));
    expect(
      await screen.findByText(/Нашли 2 из 3: у 2 — дом, у 0 — только улица/),
    ).toBeInTheDocument();
    const missed = screen.getByRole('region', { name: 'Адреса без точки' });
    expect(within(missed).getByText('Химки, ул. Мира, д. 9')).toBeInTheDocument();
    expect(
      screen.getByText(/С точкой — 3 из 4; без точки — 1: их найдёт геокодер бэка/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    // отчёт: участок создан, день открывается по id участка
    expect(await screen.findByText('Участок «Север» создан')).toBeInTheDocument();
    expect(screen.getByText('2 бригады — из контрольного файла')).toBeInTheDocument();
    expect(screen.getByText('Нормативы участка: 3 типа заявок')).toBeInTheDocument();

    expect(createRegion).toHaveBeenCalledWith({
      name: 'Север',
      office: { address: 'Химки, ул. Молодёжная, д. 4', lat: 55.89, lon: 37.43 },
      norms: {
        types: [
          { type_bk: 'Ремонт ТВ', skill: 'local', duration_minutes: 45 },
          { type_bk: 'Авария', skill: 'emergency', duration_minutes: 80 },
          { type_bk: 'Подключение', skill: 'installation', duration_minutes: 70 },
        ],
      },
    });
    const [rosterRegion, roster] = vi.mocked(putRegionRoster).mock.calls[0];
    expect(rosterRegion).toBe('r-north');
    expect(roster.map((item) => [item.id, item.name, item.skills, item.latitude])).toEqual([
      ['E01', 'Иванов', ['local', 'installation'], 55.89],
      ['E02', 'Петров', ['local', 'emergency'], 55.89],
    ]);

    const files = vi.mocked(importBeeline).mock.calls[0][0] as ImportFiles;
    expect(files).toMatchObject({ regionId: 'r-north', date: '2026-09-29' });
    const requestsCsv = (await readCsvText(files.requestsFile)).text.split('\r\n');
    expect(requestsCsv[1]).toBe(
      'A-1;Подключение;;29.09.2026 10:00;29.09.2026 12:00;;Химки, ул. Кирова, д. 5;Нет;;;installation;70;55.900000;37.440000',
    );
    expect(requestsCsv[2]).toBe(
      'A-2;Ремонт ТВ;;29.09.2026 12:00;29.09.2026 14:00;;Химки, ул. Ленина, д. 7;Нет;;;local;45;55.880000;37.440000',
    );
    expect(requestsCsv[4]).toBe('A-4;Авария;;;;;Химки, ул. Мира, д. 9;Нет;;;emergency;80;;');
    expect(requestsCsv[5]).toBe('Адрес офиса;Химки, ул. Молодёжная, д. 4');
    const control = (await readCsvText(files.controlFile as File)).text.split('\r\n');
    expect(control[3]).toBe(
      'A-3;Ремонт ТВ;29.09.2026 14:00;29.09.2026 16:00;Химки, ул. Мира, д. 1;Петров',
    );
    const engineers = (await readCsvText(files.engineersFile as File)).text.split('\n');
    expect(engineers[1]).toBe('E01,Иванов,55.89,37.43,10:00,16:00,local;installation,car,true');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть день' }));
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/dispatcher/day/2026-09-29?region=r-north',
    );
  });

  it('свой участок в списке: карточка с офисом; загрузка обновляет его, а не создаёт новый', async () => {
    vi.mocked(getRegions).mockResolvedValue([
      ...CASE_REGIONS,
      region('r-north', 'Север', {
        builtin: false,
        engineer_count: 2,
        office: { address: 'Химки, ул. Молодёжная, д. 4', lat: 55.89, lon: 37.43 },
        norms: { types: [{ type_bk: 'Ремонт ТВ', skill: 'local', duration_minutes: 45 }] },
      }),
    ]);
    vi.mocked(getRegionRoster).mockResolvedValue([
      {
        id: 'E07',
        name: 'Иванов',
        latitude: 55.89,
        longitude: 37.43,
        shift_start: '09:00',
        shift_end: '18:00',
        skills: ['local', 'installation', 'emergency'],
        transport: 'bike',
      },
    ]);
    vi.mocked(patchRegion).mockImplementation(async (id, body) =>
      region(id, body.name ?? 'Север', { builtin: false }),
    );
    renderModal();
    const card = await screen.findByRole('region', { name: 'Север' });
    expect(within(card).getByText('2 бригады · свой участок')).toBeInTheDocument();
    expect(within(card).getByText('Офис: Химки, ул. Молодёжная, д. 4')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Загрузить файл участка' }));

    expect(await screen.findByRole('dialog', { name: 'Участок «Север»' })).toBeInTheDocument();
    expect(screen.getByLabelText('Название участка')).toHaveValue('Север');
    expect(screen.getByText('Точка офиса выбрана')).toBeInTheDocument();
    pickFile('Файл заявок (.csv)', csvFile('himki.csv', FOREIGN_CSV));
    pickFile(
      'Контрольное распределение — по желанию',
      csvFile('himki_control.csv', FOREIGN_CONTROL),
    );
    expect(await screen.findByText('4 строки · 1 КБ')).toBeInTheDocument();
    next();
    await subtitle('2 из 5');
    next();
    // норматив участка важнее угадывания
    await subtitle('3 из 5');
    expect(screen.getByText('норматив участка')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Минут · Ремонт ТВ' })).toHaveValue(45);
    next();
    // известная участку бригада — с сохранёнными id, навыками и транспортом
    await subtitle('4 из 5');
    expect(screen.getByRole('combobox', { name: 'Транспорт · Иванов' })).toHaveValue('bike');
    next();
    await subtitle('5 из 5');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));

    expect(
      await screen.findByText('Участок «Север»: офис, нормативы и бригады обновлены'),
    ).toBeInTheDocument();
    expect(createRegion).not.toHaveBeenCalled();
    expect(patchRegion).toHaveBeenCalledWith('r-north', expect.objectContaining({ name: 'Север' }));
    const roster = vi.mocked(putRegionRoster).mock.calls[0][1];
    expect(roster.map((item) => [item.id, item.name, item.transport])).toEqual([
      ['E07', 'Иванов', 'bike'],
      ['E01', 'Петров', 'car'],
    ]);
  });

  it('участок создан, а ростер не сохранился: ошибка в мастере, повтор обновляет созданный', async () => {
    vi.mocked(putRegionRoster)
      .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_ERROR', 'Плохой ростер'))
      .mockImplementation(async (_id, roster) => roster);
    vi.mocked(patchRegion).mockImplementation(async (id, body) =>
      region(id, body.name ?? 'Север', { builtin: false }),
    );
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Настроить загрузку' }));
    fireEvent.change(screen.getByLabelText('Название участка'), { target: { value: 'Север' } });
    pickFile('Файл заявок (.csv)', csvFile('himki.csv', FOREIGN_CSV));
    await screen.findByText('Точка по адресу: Молодёжная улица, 4');
    for (const step of ['2', '3', '4', '5']) {
      next();
      await subtitle(`${step} из 5`);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    expect(
      await screen.findByText('Участок создан, но загрузка не прошла: Плохой ростер'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    expect(await screen.findByText(/Участок «Север»/)).toBeInTheDocument();
    await waitFor(() => expect(patchRegion).toHaveBeenCalledWith('r-north', expect.anything()));
    expect(createRegion).toHaveBeenCalledTimes(1);
  });
});
