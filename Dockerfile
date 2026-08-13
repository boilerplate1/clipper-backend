FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV DATABASE_URL="postgresql://clipper:clipper@localhost:5432/clipper?schema=public"
RUN npm run build

ENV NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main"]
