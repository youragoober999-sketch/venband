# PocketBase — free, self-hosted backend (auth, realtime, DB, files) in one binary.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates unzip wget
ARG PB_VERSION=0.22.20
RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /pb \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip
WORKDIR /pb
EXPOSE 8080
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]