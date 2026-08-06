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

# Copy sources
RUN mkdir /app
WORKDIR /app
COPY framerail/ ./
COPY assets ./src/assets

# Install app
RUN \
    pnpm install --frozen-lockfile && \
    pnpm build && \
    pnpm prune --prod && \
    rm -rf tests/

# Run command
USER node:node
ENV NODE_ENV=production
ENV PORT=3393
EXPOSE 3393

CMD ["/usr/local/bin/node", "server.js"]
