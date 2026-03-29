# Stage 1: Build the full monorepo
FROM node:20-bookworm AS builder

RUN npm install -g pnpm@9.15.4

# Install build tools for native modules (node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything
COPY . .

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build all packages (core, plugins, then web)
RUN pnpm run build

# Stage 2: Production image
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    tmux \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy the entire built monorepo (workspace deps require full structure)
COPY --from=builder /app .

ENV NODE_ENV=production
ENV PORT=3000
ENV TERMINAL_PORT=14800
ENV DIRECT_TERMINAL_PORT=14801
ENV NEXT_PUBLIC_TERMINAL_PORT=14800
ENV NEXT_PUBLIC_DIRECT_TERMINAL_PORT=14801

EXPOSE 3000 14800 14801

WORKDIR /app/packages/web
CMD ["node", "dist-server/start-all.js"]
