FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_AUTH_ENABLED=true
ARG NEXT_PUBLIC_KEYCLOAK_ISSUER
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=healthagent-web
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_AUTH_ENABLED=$NEXT_PUBLIC_AUTH_ENABLED \
    NEXT_PUBLIC_KEYCLOAK_ISSUER=$NEXT_PUBLIC_KEYCLOAK_ISSUER \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
RUN npx prisma generate && npm run build:web

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
