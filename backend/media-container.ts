import { Container } from "@cloudflare/containers";
import type { Env } from "./types.ts";

export class MediaContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "15m";
  envVars = {
    MEDIA_SERVICE_TOKEN: this.env.MEDIA_SERVICE_TOKEN,
    MEDIA_ORIGIN: new URL(this.env.MEDIA_API_URL ?? this.env.PUBLIC_API_URL)
      .origin,
  };
}
