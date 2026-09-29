#!/usr/bin/env bash
# Инициализация локального OSRM (только автомобильный профиль, MLD).
#
#   - скачивает PBF (Москва и МО = Central Federal District), если нет;
#   - собирает граф: osrm-extract (car.lua) -> osrm-partition -> osrm-customize;
#   - готовит данные для osrm-routed (алгоритм MLD, max-table-size 10000).
#
# Запуск:  bash osrm/init_osrm.sh
# Данные:  DATA_DIR (по умолчанию /root/osrm-data)
set -euo pipefail

DATA_DIR="${DATA_DIR:-/root/osrm-data}"
IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:latest}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/russia/central-fed-district-latest.osm.pbf}"
PBF_NAME="${PBF_NAME:-map.osm.pbf}"
PROFILE="${OSRM_PROFILE:-/opt/car.lua}"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

if [ ! -s "$PBF_NAME" ]; then
    echo "[osrm] скачиваю $PBF_URL"
    wget -O "$PBF_NAME" "$PBF_URL"
else
    echo "[osrm] PBF уже есть: $PBF_NAME ($(du -h "$PBF_NAME" | cut -f1))"
fi

run_osrm() {
    docker run --rm -v "$DATA_DIR:/data" "$IMAGE" "$@"
}

if [ ! -f "map.osrm" ]; then
    echo "[osrm] osrm-extract (профиль car.lua)"
    run_osrm osrm-extract -p "$PROFILE" "/data/$PBF_NAME"
else
    echo "[osrm] граф уже извлечён"
fi

if [ ! -f "map.osrm.partition" ] && [ ! -f "map.osrm.cell_metrics" ]; then
    echo "[osrm] osrm-partition (MLD)"
    run_osrm osrm-partition /data/map.osrm
    echo "[osrm] osrm-customize (MLD)"
    run_osrm osrm-customize /data/map.osrm
else
    echo "[osrm] MLD уже настроен"
fi

echo "[osrm] готово: $DATA_DIR/map.osrm"
echo "[osrm] запуск: docker compose up -d osrm"
