FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN mkdir -p public

ARG APP_URL
ARG NEXT_PUBLIC_WELIO_API_URL
ENV APP_URL=${APP_URL}
ENV NEXT_PUBLIC_WELIO_API_URL=${NEXT_PUBLIC_WELIO_API_URL}

RUN pnpm build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=build --chown=nextjs:nextjs /app/.next-build/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next-build/static ./.next-build/static
COPY --from=build --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
