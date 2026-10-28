FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV BACKUP_DIR=/data/backups
ENV MYSQLDUMP_PATH=/usr/bin/mysqldump
RUN apk add --no-cache openssl mariadb-client && mkdir -p /data/backups && chown -R node:node /data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
