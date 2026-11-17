import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

// KV holds the ISR payloads instead of R2, so the deployment needs no payment
// method. The revalidation queue and tag cache stay on Durable Objects, which
// are free and need no provisioning.
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  queue: doQueue,
  tagCache: doShardedTagCache({ baseShardSize: 4 }),
});
