FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY migrations/ migrations/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/welio ./cmd/welio

FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 welio
COPY --from=build /out/welio /usr/local/bin/welio
USER welio
ENV HTTP_ADDR=:8081
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["welio", "healthcheck"]
ENTRYPOINT ["welio"]
CMD ["serve"]
