# syntax=docker/dockerfile:1

#
# Framerail build
#

FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

# SvelteKit materializes CSP and CSRF options while `pnpm build` runs; standing may pass `local` for CSP only.
ARG FRAMERAIL_ENV=prod
ARG FRAMERAIL_CSRF_CHECK_ORIGIN=true
ENV FRAMERAIL_ENV=${FRAMERAIL_ENV}
ENV FRAMERAIL_CSRF_CHECK_ORIGIN=${FRAMERAIL_CSRF_CHECK_ORIGIN}

# Install dependencies
RUN apk add --no-cache curl && \
    npm install --global pnpm@11.10.0

# Install the locked dependencies before copying the sources, so a source
# change reuses this layer. The pnpm store is a build cache.
RUN mkdir /app
WORKDIR /app
COPY framerail/package.json framerail/pnpm-lock.yaml framerail/pnpm-workspace.yaml framerail/.npmrc ./
COPY framerail/patches ./patches
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# Copy sources
COPY framerail/ ./
COPY assets ./src/assets

# Build app
RUN \
    pnpm build && \
    pnpm prune --prod && \
    rm -rf tests/

# Run command
USER node:node
ENV NODE_ENV=production
ENV PORT=3393
EXPOSE 3393

CMD ["/usr/local/bin/node", "server.js"]
