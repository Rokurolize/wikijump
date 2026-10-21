#
# Framerail build
#

FROM node:24.22.1-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d

RUN apk add --no-cache curl
RUN npm install --global pnpm@11.10.0
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH

# Keep dependency installation in a manifest-only layer. Source edits are
# bind-mounted by docker-compose.dev.yaml and do not rebuild this layer.
COPY framerail/package.json framerail/pnpm-lock.yaml framerail/pnpm-workspace.yaml ./
# `pnpm-workspace.yaml` declares patchedDependencies; the manifest layer must
# contain the patch files or `pnpm install --frozen-lockfile` fails.
COPY framerail/patches ./patches
RUN pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY framerail ./
COPY assets ./src/assets

# Install files
COPY ./install/local/framerail/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./install/local/framerail/framerail-start /usr/local/bin/framerail-start

EXPOSE 3393
ARG FRAMERAIL_ENV=local
ARG FRAMERAIL_CSRF_CHECK_ORIGIN=true
ENV FRAMERAIL_ENV=${FRAMERAIL_ENV}
ENV FRAMERAIL_CSRF_CHECK_ORIGIN=${FRAMERAIL_CSRF_CHECK_ORIGIN}
CMD ["framerail-start"]
