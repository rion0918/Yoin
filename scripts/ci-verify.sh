#!/usr/bin/env bash
set -euo pipefail

npm ci
npm --prefix backend ci
npm --prefix backend/media ci
npm run check
npm run typecheck
npm test
npm run backend:typecheck
npm run backend:test

FFMPEG_BIN="$(command -v ffmpeg)"
FFPROBE_BIN="$(command -v ffprobe)"
export FFMPEG_BIN FFPROBE_BIN

media_image="yoin-audio:${GITHUB_SHA:-local}"
docker buildx build --load --platform linux/amd64 --file backend/media/Dockerfile --tag "$media_image" .
speaker_model_path="$RUNNER_TEMP/wespeaker_en_voxceleb_resnet34_LM.onnx"
docker run --rm --entrypoint cat "$media_image" /app/backend/media/models/wespeaker_en_voxceleb_resnet34_LM.onnx > "$speaker_model_path"
export SPEAKER_MODEL_PATH="$speaker_model_path"
segmentation_model_path="$RUNNER_TEMP/pyannote-segmentation-3.0.int8.onnx"
docker run --rm --entrypoint cat "$media_image" /app/backend/media/models/pyannote-segmentation-3.0.int8.onnx > "$segmentation_model_path"
export SPEAKER_SEGMENTATION_MODEL_PATH="$segmentation_model_path"

npm --prefix backend run test:media
npm run export
npm --prefix backend run dry-run

container_id="$(docker run --detach --platform linux/amd64 --publish 127.0.0.1:18080:8080 --env MEDIA_SERVICE_TOKEN=ci-test-token-ci-test-token-ci-test-token-ci-test-token --env MEDIA_ORIGIN=https://yoin.test "$media_image")"
trap 'docker rm --force "$container_id" >/dev/null 2>&1 || true' EXIT

health_url=http://127.0.0.1:18080/health
for attempt in $(seq 1 30); do
  if curl --silent --fail "$health_url" --output /dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Audio service did not become healthy within 30 seconds." >&2
    exit 1
  fi
  sleep 1
done
test "$(curl --silent --show-error --fail "$health_url")" = ok

for route in inspect probe transcribe lyrics readings music enroll-speaker identify-speakers accounts/delete; do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "http://127.0.0.1:18080/$route" --data '{}')"
  test "$status" = 401
done

if [[ "${GITHUB_REF:-}" == refs/heads/main && "${GITHUB_EVENT_NAME:-}" =~ ^(push|workflow_dispatch)$ && -n "${GITHUB_ACTIONS:-}" ]]; then
  docker save --output "$RUNNER_TEMP/yoin-audio.tar" "$media_image"
fi
