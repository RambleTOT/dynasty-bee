import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import { RequestDrawer } from './RequestDrawer';

const handlers = () => ({
  onClose: vi.fn(),
  onCancel: vi.fn(),
  onReassign: vi.fn(),
  onShowInList: vi.fn(),
});

describe('DS-04 «Карточка заявки» с карты — диалог', () => {
  it('назначенная: факты, «Почему этот инженер», «Переназначить» и «Отменить заявку»', () => {
    const on = handlers();
    const model = overlayModel();
    const number = model.requestById.get('305800002')!.number;
    render(<RequestDrawer as="dialog" model={model} requestId="305800002" {...on} />);

    const dialog = screen.getByRole('dialog', { name: number });
    expect(within(dialog).getByText('Почему этот инженер')).toBeInTheDocument();
    expect(within(dialog).getByText('Приезд · начало · окончание')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Переназначить' }));
    expect(on.onReassign).toHaveBeenCalledWith('305800002');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отменить заявку' }));
    expect(on.onCancel).toHaveBeenCalledWith('305800002');
  });

  it('неназначенная: причина, «Назначить вручную» и «В списке неназначенных»', () => {
    const on = handlers();
    const model = overlayModel();
    const number = model.requestById.get('305800007')!.number;
    render(<RequestDrawer as="dialog" model={model} requestId="305800007" {...on} />);

    const dialog = screen.getByRole('dialog', { name: number });
    expect(within(dialog).getByText('Не назначен')).toBeInTheDocument();
    expect(within(dialog).getByText('Почему не назначена')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Назначить вручную' }));
    expect(on.onReassign).toHaveBeenCalledWith('305800007');
    fireEvent.click(within(dialog).getByRole('button', { name: 'В списке неназначенных' }));
    expect(on.onShowInList).toHaveBeenCalledWith('305800007');
  });

  it('до плана: только факты, без действий', () => {
    const on = handlers();
    const model = overlayModel({ planState: 'none' });
    const number = model.requestById.get('305800001')!.number;
    render(<RequestDrawer as="dialog" model={model} requestId="305800001" {...on} />);

    const dialog = screen.getByRole('dialog', { name: number });
    expect(within(dialog).getByText('План ещё не построен')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Назначить вручную' })).toBeNull();
    expect(within(dialog).queryByText('Почему не назначена')).toBeNull();
  });

  it('из предложения: только смотреть, внизу «К предложению»; новой заявки в плане ещё нет', () => {
    const on = { ...handlers(), onBack: vi.fn() };
    const model = overlayModel();
    const { unmount } = render(
      <RequestDrawer as="dialog" model={model} requestId="305800002" {...on} />,
    );
    const dialog = screen.getByRole('dialog', { name: model.requestById.get('305800002')!.number });
    expect(within(dialog).queryByRole('button', { name: 'Переназначить' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Отменить заявку' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'К предложению' }));
    expect(on.onBack).toHaveBeenCalled();
    unmount();

    render(<RequestDrawer as="dialog" model={model} requestId="U-0001" {...on} />);
    expect(screen.getByText('Заявка есть только в предложении')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'К предложению' })).toBeInTheDocument();
  });

  it('из списков (дровер) неназначенную не открываем — «не найдена в текущей версии»', () => {
    render(<RequestDrawer model={overlayModel()} requestId="305800007" {...handlers()} />);
    expect(screen.getByText('Заявка не найдена в текущей версии плана')).toBeInTheDocument();
  });
});
