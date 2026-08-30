# This image deliberately contains the full source tree and build toolchain.
# The production build happens only after the isolated PostgreSQL service is
# healthy, because several server-rendered routes require DATABASE_URL while
# Next.js performs its build-time checks.
FROM node:24-bookworm

ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@11.5.0 --activate \
    && chown node:node /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./

USER node

RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
RUN chmod 0755 deploy/trial/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./deploy/trial/entrypoint.sh"]
CMD ["app"]
