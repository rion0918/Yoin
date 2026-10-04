FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
