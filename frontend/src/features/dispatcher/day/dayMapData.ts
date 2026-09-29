/**
 * Что рисует карта дня (DS-03, FRONTEND_SPEC §6.6) — одинаково на Яндекс Карте и на запасной карте
 * OSM: маркеры заявок (HTML с классами DayMap.module.css), линии маршрутов цветом бригады,
 * приглушение по чипу бригады и по предложению, точки для подгонки масштаба.
 */
import type { DayFilters, DayModel, DayRequest } from '@/adapters/dayModel';
import { matchesFilters } from '@/adapters/dayModel';
import { dayBounds, routeLines, type RouteLine } from '@/adapters/geo';
import type { GeoJsonCollection } from '@/api/types';
import type { LatLng } from '@/lib/map';
import { cx } from '@/ui';
import { BUILDING_SVG, CHECK_SVG, ZAP_SVG } from './markerIcons';
import styles from './DayMap.module.css';

export interface MapHighlight {
  /** Бригады, чьи маршруты меняются: подсвечены, остальные приглушены. */
  engineers: ReadonlySet<string>;
  /** Новые линии этих бригад (из предложения). */
  lines: RouteLine[];
  /** Прежние линии этих бригад — серым пунктиром. */
  ghost: RouteLine[];
  /** Предложение, к которому можно вернуться. */
  planId: string | null;
}

export type DayMarkerKind = 'stop' | 'urgent' | 'unassigned' | 'plain';

export interface DayMarker {
  /** Номер заявки: по клику — карточка заявки. */
  id: string;
  /** Меняется вместе с видом маркера: карта OSM пересоздаёт маркер, Яндекс — перерисовывает. */
  key: string;
  kind: DayMarkerKind;
  point: LatLng;
  /** Содержимое маркера: кружок с номером, авария, неназначенная, точка до плана. */
  html: string;
  size: number;
  dim: boolean;
  /** Порядок наложения: авария и выбранная — выше, приглушённые — ниже. */
  z: number;
  /** Подсказка при наведении. */
  title: string;
  sub: string;
}

export interface DayLine {
  key: string;
  points: LatLng[];
  /** Цвет бригады — `--route-N`; прежняя линия предложения — `--line-strong`. */
  colorVar: string;
  /** Класс линии для карты OSM: Leaflet пишет цвет в атрибут, где var() не работает. */
  className: string;
  dashed: boolean;
  dim: boolean;
  /** Прежняя линия бригады, чей маршрут меняет предложение. */
  ghost: boolean;
}

export interface DayOffice {
  point: LatLng;
  html: string;
  title: string;
  sub: string;
}

export interface DayMapData {
  markers: DayMarker[];
  /** Сначала прежние линии предложения, потом маршруты. */
  lines: DayLine[];
  office: DayOffice | null;
  bounds: LatLng[];
  /** Подгоняем масштаб только при смене дня, региона, версии: опрос не сбивает ручной масштаб. */
  fitKey: string;
}

interface DayMapInput {
  model: DayModel;
  geojson: GeoJsonCollection | null;
  filters: DayFilters;
  brigade: string | null;
  selectedRequest: string | null;
  highlight?: MapHighlight | null;
}

export const colorClass = (index: number) => styles[`c${index}`];

function tooltip(request: DayRequest, model: DayModel): { title: string; sub: string } {
  const engineer = request.engineerId ? model.engineerById.get(request.engineerId) : null;
  return {
    title: `№${request.id} · ${request.typeBk} · окно ${request.windowShort}`,
    sub:
      engineer && request.visit
        ? `${engineer.label} · начало ${request.visit.start}`
        : request.status === 'unassigned' && model.plan
          ? 'Не назначена'
          : request.addressText,
  };
}

export function buildDayMapData({
  model,
  geojson,
  filters,
  brigade,
  selectedRequest,
  highlight,
}: DayMapInput): DayMapData {
  const hasPlan = Boolean(model.plan);
  const dimmedEngineer = (engineerId: string | null) => {
    if (highlight) return !engineerId || !highlight.engineers.has(engineerId);
    return Boolean(brigade) && engineerId !== brigade;
  };

  const current = hasPlan ? routeLines(model, geojson) : [];
  // изменённые бригады — линиями предложения, остальные — как в действующем плане
  const routes = highlight
    ? [...current.filter((l) => !highlight.engineers.has(l.engineerId)), ...highlight.lines]
    : current;
  const lines: DayLine[] = [
    ...(highlight?.ghost ?? []).map((line) => ({
      key: `ghost-${line.engineerId}`,
      points: line.points,
      colorVar: '--line-strong',
      className: styles.ghost,
      dashed: true,
      dim: false,
      ghost: true,
    })),
    ...routes.flatMap((line) => {
      const engineer = model.engineerById.get(line.engineerId);
      if (!engineer) return [];
      const dim = dimmedEngineer(line.engineerId);
      return [
        {
          key: `${line.engineerId}:${dim}`,
          points: line.points,
          colorVar: `--route-${engineer.color.index}`,
          className: cx(styles.route, colorClass(engineer.color.index)),
          dashed: engineer.color.dashed,
          dim,
          ghost: false,
        },
      ];
    }),
  ];

  const markers = model.requests
    .filter((r) => r.point && r.status !== 'cancelled' && r.status !== 'rescheduled')
    .map((request): DayMarker => {
      const engineer = request.engineerId ? model.engineerById.get(request.engineerId) : null;
      const dim = !matchesFilters(request, filters) || dimmedEngineer(request.engineerId);
      const selected = request.id === selectedRequest;
      // до плана — нейтральные точки (§6.6)
      let kind: DayMarkerKind;
      if (!hasPlan) kind = 'plain';
      else if (request.emergency && request.status !== 'done') kind = 'urgent';
      else if (!request.visit) kind = 'unassigned';
      else kind = 'stop';

      let html: string;
      let size = 24;
      if (kind === 'urgent') {
        size = 28;
        html = `<div class="${cx(styles.urgent, selected && styles.selected)}">${ZAP_SVG(16)}</div>`;
      } else if (kind === 'unassigned') {
        html = `<div class="${cx(styles.unassigned, selected && styles.selected)}">!</div>`;
      } else if (kind === 'plain') {
        size = 14;
        html = `<div class="${cx(styles.plain, selected && styles.selected)}"></div>`;
      } else {
        const done = request.status === 'done';
        const active = request.status === 'in_progress' || request.status === 'en_route';
        html = `<div class="${cx(
          styles.stop,
          engineer && colorClass(engineer.color.index),
          done && styles.done,
          active && styles.active,
          selected && styles.selected,
        )}">${done ? CHECK_SVG(14) : (request.visit?.sequence ?? '')}</div>`;
      }
      return {
        id: request.id,
        key: `${request.id}:${kind}:${dim}:${selected}:${request.status}:${request.visit?.sequence ?? ''}:${engineer?.color.index ?? ''}`,
        kind,
        point: request.point as LatLng,
        html,
        size,
        dim,
        z: kind === 'urgent' ? 600 : selected ? 800 : dim ? -200 : 0,
        ...tooltip(request, model),
      };
    });

  const office: DayOffice | null = model.office
    ? {
        point: model.office.point,
        html: `<div class="${styles.office}">${BUILDING_SVG(16)}</div>`,
        title: 'Офис',
        sub: model.office.address ?? '',
      }
    : null;

  const bounds = dayBounds(model);
  return {
    markers,
    lines,
    office,
    bounds,
    fitKey: `${model.date}:${model.regionId}:${model.planId ?? 'none'}:${bounds.length > 0}`,
  };
}
