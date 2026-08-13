# Быстрый деплой на VPS (всё в Docker)

Разворачивает: **Postgres + RabbitMQ + backend + worker**. Фронтенд остаётся локальным.

## Один раз на VPS

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Загрузка и запуск (клонирует оба репозитория, создаёт .env)
bash <(curl -s https://raw.githubusercontent.com/boilerplate1/clipper-backend/master/deploy/deploy.sh)
```

Или вручную:

```bash
git clone https://github.com/boilerplate1/clipper-backend.git
cd clipper-backend/deploy
cp env.example .env
nano .env                     # GROQ_API_KEY, S3_*, POSTGRES_PASSWORD
git clone https://github.com/boilerplate1/clipper-worker.git ../worker
docker compose up -d --build
```

## Что заполнить в `.env`

| Переменная | Где взять |
|---|---|
| `GROQ_API_KEY` | console.groq.com (ключ уже есть у тебя) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | твой s3.twcstorage.ru |
| `S3_BUCKET` | `a51acb36-82f1-4cbd-a830-8547ecd3116a` |
| `POSTGRES_PASSWORD` | любое, поменяй с `change_me` |

## Полезно

```bash
docker compose logs -f backend worker   # логи
docker compose ps                        # статус
docker compose restart worker            # перезапуск воркера
```

## Фронтенд (локально)

`VITE_API_URL` на VPS-бэкенд — `.env` в `frontend/`:

```
VITE_API_URL=http://VPS_IP:4000
```

Порт 4000 открыт, CORS включён. БД и RabbitMQ наружу **не** проброшены (только внутрь docker-сети).
