import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overlayBaseline, overlayCompare, overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import { comparePlans, getBaseline } from '@/api/planning';
import { renderDay, testChain } from '@/test/dispatcherDay';
import { SummaryModal } from './SummaryModal';

vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  comparePlans: vi.fn(),
  getBaseline: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('DS-10 «Итоги дня»', () => {
  it('карточки, крупные показатели с Δ к FIFO и таблица по бригадам', async () => {
    vi.mocked(comparePlans).mockResolvedValue(overlayCompare);
    vi.mocked(getBaseline).mockResolvedValue(overlayBaseline);
    renderDay(<SummaryModal model={overlayModel()} chain={testChain} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Итоги дня · Вт, 29 сентября' });
    expect(within(dialog).getByText('Восток · версия 4')).toBeInTheDocument();

    const card = (label: string) => within(dialog).getByRole('region', { name: label });
    expect(card('Выполнено')).toHaveTextContent(/^Выполнено1из 4 назначенных$/);
    expect(card('Отменено')).toHaveTextContent(/^Отменено1клиент отказался$/);
    expect(card('Перенесено')).toHaveTextContent(/^Перенесено1на 01\.10$/);
    expect(card('Неназначенные')).toHaveTextContent(/^Неназначенные1перейдут на 30\.09$/);

    expect(await within(dialog).findByText('+1 к FIFO')).toBeInTheDocument();
    expect(card('Начато в окне')).toHaveTextContent('3 из 4');
    expect(card('Пробег суммарно, км')).toHaveTextContent(
      /^Пробег суммарно, км18,6−6,4 км \(−26%\) к FIFO$/,
    );
    expect(card('Задействовано инженеров')).toHaveTextContent(
      /^Задействовано инженеров2−1 инженер к FIFO$/,
    );

    const table = within(dialog).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Бригада', 'Заявок', 'Выполн.', 'В окне', 'Км', 'Дорога', 'Работа', 'Ожид.']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((td) => td.textContent),
      ),
    ).toEqual([
      ['Соколов', '2', '1', '2', '8,4', '0:35', '2:00', '0:10'],
      ['Мельников', '2', '0', '1', '10,2', '0:35', '1:00', '0:00'],
    ]);
  });

  it('плана нет — пустое состояние вместо итогов', () => {
    vi.mocked(comparePlans).mockResolvedValue(overlayCompare);
    renderDay(
      <SummaryModal
        model={overlayModel({ planState: 'none' })}
        chain={testChain}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('План ещё не построен')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
