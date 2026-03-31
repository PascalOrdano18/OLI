# syntax=docker/dockerfile:1

# Stage 1: Build Go plugin server
FROM golang:1.22-alpine AS go-builder
RUN apk add --no-cache make git
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY server/ ./server/
COPY plugin.json ./
COPY assets/ ./assets/
COPY Makefile ./
RUN mkdir -p server/dist && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '-s -w' -o server/dist/plugin-linux-amd64 ./server

# Stage 2: Build React webapp
FROM node:20-alpine AS node-builder
WORKDIR /build/webapp
COPY webapp/package*.json ./
RUN npm install --legacy-peer-deps
COPY webapp/ ./
RUN npm run build

# Stage 3: Bundle plugin
FROM alpine:3.19 AS bundler
WORKDIR /bundle
COPY plugin.json ./
COPY assets/ ./assets/
COPY --from=go-builder /build/server/dist/ ./server/dist/
COPY --from=node-builder /build/webapp/dist/ ./webapp/dist/

# Stage 4: Mattermost with plugin pre-installed
# Pin a release tag for reproducible builds (see Mattermost Docker docs).
FROM mattermost/mattermost-team-edition:release-10.5

# Pre-install the plugin
COPY --from=bundler /bundle/ /mattermost/plugins/com.mattermost.issues/

# Custom entrypoint that auto-enables the plugin on first boot
COPY --chmod=755 entrypoint.sh /mattermost/entrypoint.sh

# Mattermost configuration via environment variables
# Database — Railway provides a Postgres addon; override MM_SQLSETTINGS_DATASOURCE in Railway vars
ENV MM_SQLSETTINGS_DRIVERNAME=postgres
ENV MM_SERVICESETTINGS_ENABLELOCALMODE=true
ENV MM_PLUGINSETTINGS_ENABLEUPLOADS=true
ENV MM_PLUGINSETTINGS_ENABLE=true
ENV MM_LOGSETTINGS_CONSOLELEVEL=INFO
ENV MM_SERVICESETTINGS_ENABLETESTING=true
ENV MM_SERVICESETTINGS_ENABLEDEVELOPER=true

EXPOSE 8065

ENTRYPOINT ["/mattermost/entrypoint.sh"]
