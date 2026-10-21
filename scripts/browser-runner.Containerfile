# Supply an operator-reviewed digest for a Playwright image matching package.json.
# Build only in a temporary context containing this file, package.json and pnpm-lock.yaml.
ARG PLAYWRIGHT_IMAGE
FROM ${PLAYWRIGHT_IMAGE}
USER root
WORKDIR /opt/browser-runner
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1
RUN npm install --global pnpm@10.15.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# Runtime overrides entrypoint and runs as the rootless invoking user, never root.
# No source code, agent credentials, host sockets or browser profiles belong in this image.
