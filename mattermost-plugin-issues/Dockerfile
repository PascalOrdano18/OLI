# syntax=docker/dockerfile:1

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

FROM node:20-alpine AS node-builder
WORKDIR /build/webapp
COPY webapp/package*.json ./
RUN npm install --legacy-peer-deps
COPY webapp/ ./
RUN npm run build

FROM alpine:3.19 AS bundler
WORKDIR /bundle
COPY plugin.json ./
COPY assets/ ./assets/
COPY --from=go-builder /build/server/dist/ ./server/dist/
COPY --from=node-builder /build/webapp/dist/ ./webapp/dist/

FROM mattermost/mattermost-team-edition:latest
COPY --from=bundler /bundle/ /mattermost/plugins/com.mattermost.issues/
