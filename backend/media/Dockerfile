FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend/media
COPY --chown=node:node backend/media/package.json backend/media/package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p models && curl -fL --retry 3 https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx -o models/wespeaker_en_voxceleb_resnet34_LM.onnx && echo "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012  models/wespeaker_en_voxceleb_resnet34_LM.onnx" | sha256sum -c -
ENV SPEAKER_MODEL_PATH=/app/backend/media/models/wespeaker_en_voxceleb_resnet34_LM.onnx
ENV LD_LIBRARY_PATH=/app/backend/media/node_modules/sherpa-onnx-linux-x64:/app/backend/media/node_modules/sherpa-onnx-linux-arm64
COPY --chown=node:node backend/media/*.mjs ./
COPY --chown=node:node pipeline/google.ts /app/pipeline/google.ts
COPY --chown=node:node shared/contracts.ts /app/shared/contracts.ts
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
