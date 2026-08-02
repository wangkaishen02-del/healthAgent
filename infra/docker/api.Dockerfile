FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build:api

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl \
    && addgroup --system --gid 1001 healthagent \
    && adduser --system --uid 1001 --ingroup healthagent healthagent \
    && mkdir -p /app/data/claim-attachments /app/data/logs \
    && chown -R healthagent:healthagent /app/data
COPY --from=builder --chown=healthagent:healthagent /app/node_modules ./node_modules
COPY --from=builder --chown=healthagent:healthagent /app/package.json ./package.json
COPY --from=builder --chown=healthagent:healthagent /app/dist ./dist
COPY --from=builder --chown=healthagent:healthagent /app/prisma ./prisma
COPY --from=builder --chown=healthagent:healthagent /app/infra/docker/database-state.mjs ./infra/docker/database-state.mjs
COPY --from=builder --chown=healthagent:healthagent /app/infra/docker/api-entrypoint.sh ./infra/docker/api-entrypoint.sh
USER healthagent
EXPOSE 3001
CMD ["sh", "/app/infra/docker/api-entrypoint.sh"]
