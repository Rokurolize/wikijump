#
# Framerail build
#

FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

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
ENV FRAMERAIL_ENV=dev
ENV PORT=3393
EXPOSE 3393

CMD ["/usr/local/bin/node", "server.js"]
