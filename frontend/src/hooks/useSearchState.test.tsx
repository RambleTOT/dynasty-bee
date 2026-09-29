import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { searchParam, useSearchState } from './useSearchState';

const schema = {
  region: searchParam.enum(['east', 'south_east', 'south_center'], 'east'),
  view: searchParam.enum(['map', 'timeline'], 'map'),
  request: searchParam.string(),
  q: searchParam.string(''),
  page: searchParam.number(1),
  engineer: searchParam.number(),
  status: searchParam.list(['planned', 'done', 'late']),
  tags: searchParam.list(),
};

function renderSearch(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter
      initialEntries={[url]}
      future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
    >
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => {
      const [values, setValues] = useSearchState(schema);
      return {
        values,
        setValues,
        search: useLocation().search,
        navigationType: useNavigationType(),
      };
    },
    { wrapper },
  );
}

describe('useSearchState', () => {
  it('пустой адрес — значения по умолчанию', () => {
    const { result } = renderSearch('/dispatcher/day/2026-09-28');
    expect(result.current.values).toEqual({
      region: 'east',
      view: 'map',
      request: null,
      q: '',
      page: 1,
      engineer: null,
      status: [],
      tags: [],
    });
  });

  it('читает строку, число, enum и список', () => {
    const { result } = renderSearch(
      '/x?region=south_center&view=timeline&request=R-7&q=Москва&page=3&engineer=12&status=done,late&tags=a,b,a',
    );
    expect(result.current.values).toEqual({
      region: 'south_center',
      view: 'timeline',
      request: 'R-7',
      q: 'Москва',
      page: 3,
      engineer: 12,
      status: ['done', 'late'],
      tags: ['a', 'b'],
    });
  });

  it('мусор в адресе — значения по умолчанию, незнакомые элементы списка отбрасываются', () => {
    const { result } = renderSearch('/x?region=north&view=&page=abc&status=done,oops');
    expect(result.current.values).toMatchObject({
      region: 'east',
      view: 'map',
      page: 1,
      status: ['done'],
    });
  });

  it('запись: replace, значения по умолчанию из адреса убираются, чужие параметры остаются', () => {
    const { result } = renderSearch('/x?modal=event&view=timeline');
    act(() => {
      result.current.setValues({
        view: 'map',
        request: 'R-1',
        status: ['planned', 'late'],
        page: 2,
      });
    });
    const params = new URLSearchParams(result.current.search);
    expect(params.get('modal')).toBe('event');
    expect(params.has('view')).toBe(false);
    expect(params.get('request')).toBe('R-1');
    expect(params.get('status')).toBe('planned,late');
    expect(params.get('page')).toBe('2');
    expect(result.current.navigationType).toBe('REPLACE');
    expect(result.current.values).toMatchObject({ view: 'map', request: 'R-1', page: 2 });
  });

  it('null и пустой список убирают параметр', () => {
    const { result } = renderSearch('/x?request=R-1&status=done');
    act(() => {
      result.current.setValues({ request: null, status: [] });
    });
    expect(result.current.search).toBe('');
  });

  it('два вызова подряд складываются, запись из старого замыкания не возвращает закрытое', () => {
    const { result } = renderSearch('/x?view=timeline');
    const stale = result.current.setValues;
    act(() => {
      result.current.setValues({ request: 'R-1' });
      result.current.setValues({ page: 2 });
    });
    expect(result.current.values).toMatchObject({ request: 'R-1', page: 2, view: 'timeline' });

    act(() => stale({ view: 'map' }));
    expect(result.current.values).toMatchObject({ request: 'R-1', page: 2, view: 'map' });
  });

  it('функциональное обновление от текущих значений', () => {
    const { result } = renderSearch('/x?page=4');
    act(() => {
      result.current.setValues((current) => ({ page: current.page + 1 }));
    });
    expect(result.current.values.page).toBe(5);
  });
});
