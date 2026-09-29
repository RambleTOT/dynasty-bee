# Образ API сервиса планирования маршрутов.
# Контекст сборки — корень репозитория (см. docker-compose.yml), чтобы в образ
# попал и существующий алгоритм из routing_algorithm/.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Сначала зависимости — слой кэшируется между сборками.
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Существующий алгоритм (не изменяется) и код API.
COPY routing_algorithm/ /app/routing_algorithm/
COPY backend/ /app/backend/

WORKDIR /app/backend

# Каталог для файла SQLite при запуске без внешней БД.
RUN mkdir -p /app/backend/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
