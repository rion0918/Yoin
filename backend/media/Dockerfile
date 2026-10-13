FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend/media
COPY --chown=node:node backend/media/package.json backend/media/package-lock.json ./
RUN npm ci --omit=dev
RUN mkdir -p models && curl -fL --retry 3 https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx -o models/wespeaker_en_voxceleb_resnet34_LM.onnx && echo "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012  models/wespeaker_en_voxceleb_resnet34_LM.onnx" | sha256sum -c -
RUN curl -fL --retry 3 https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 -o /tmp/segmentation.tar.bz2 && echo "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488  /tmp/segmentation.tar.bz2" | sha256sum -c - && tar -xjf /tmp/segmentation.tar.bz2 -C /tmp && cp /tmp/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx models/pyannote-segmentation-3.0.int8.onnx && cp /tmp/sherpa-onnx-pyannote-segmentation-3-0/LICENSE models/pyannote-segmentation-3.0.LICENSE && echo "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d  models/pyannote-segmentation-3.0.int8.onnx" | sha256sum -c - && rm -rf /tmp/segmentation.tar.bz2 /tmp/sherpa-onnx-pyannote-segmentation-3-0
ENV SPEAKER_SEGMENTATION_MODEL_PATH=/app/backend/media/models/pyannote-segmentation-3.0.int8.onnx
ENV SPEAKER_MODEL_PATH=/app/backend/media/models/wespeaker_en_voxceleb_resnet34_LM.onnx
ENV LD_LIBRARY_PATH=/app/backend/media/node_modules/sherpa-onnx-linux-x64:/app/backend/media/node_modules/sherpa-onnx-linux-arm64
COPY --chown=node:node backend/media/*.mjs ./
COPY --chown=node:node pipeline/google.ts /app/pipeline/google.ts
COPY --chown=node:node shared/contracts.ts /app/shared/contracts.ts
COPY --chown=node:node shared/music.ts /app/shared/music.ts
COPY --chown=node:node shared/speaker-matching.ts /app/shared/speaker-matching.ts
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
