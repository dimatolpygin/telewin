FROM node:24-alpine

WORKDIR /app

# wget нужен для healthcheck контейнера (в alpine это busybox-wget)
RUN apk add --no-cache wget

# Слой зависимостей отдельно: правка кода не будет пересобирать npm ci
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# chmod здесь, а не в git: на Windows бит исполнения не сохраняется
RUN chmod +x docker/entrypoint.sh

ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["npx", "tsx", "watch", "src/index.ts"]
