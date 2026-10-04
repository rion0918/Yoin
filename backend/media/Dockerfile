FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend/media
COPY --chown=node:node backend/media/*.mjs ./
COPY --chown=node:node pipeline/google.ts /app/pipeline/google.ts
COPY --chown=node:node shared/contracts.ts /app/shared/contracts.ts
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
