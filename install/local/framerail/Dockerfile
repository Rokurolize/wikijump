#
# Framerail build
#

FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

RUN apk add --no-cache curl
RUN npm install --global pnpm@11.10.0
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH

# Keep dependency installation in a manifest-only layer. Source edits are
# bind-mounted by docker-compose.dev.yaml and do not rebuild this layer.
COPY framerail/package.json framerail/pnpm-lock.yaml framerail/pnpm-workspace.yaml ./
RUN pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY framerail ./
COPY assets ./src/assets

# Install files
COPY ./install/local/framerail/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./install/local/framerail/framerail-start /usr/local/bin/framerail-start

EXPOSE 3393
ENV FRAMERAIL_ENV=local
CMD ["framerail-start"]
