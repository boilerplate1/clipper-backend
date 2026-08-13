# Groq-прокси на Cloudflare Workers

VPS-IP блокируется Groq (403). Воркер на Cloudflare ходит в Groq со своих IP и отдаёт ответ нашему бэкенду.

## Деплой (один раз)

```bash
cd groq-proxy
npx wrangler login          # авторизация в Cloudflare (браузер)
npx wrangler deploy         # URL вида https://clipper-groq-proxy.<поддомен>.workers.dev
```

## Подключение бэкенда

В `/opt/clipper/backend/deploy/.env` добавить:

```
GROQ_API_BASE=https://clipper-groq-proxy.<поддомен>.workers.dev
```

и перезапустить бэкенд:

```bash
cd /opt/clipper/backend/deploy && sudo docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d backend
```

Проверка: `sudo docker logs clipper_backend | grep GROQ` — транскрипция должна проходить.
