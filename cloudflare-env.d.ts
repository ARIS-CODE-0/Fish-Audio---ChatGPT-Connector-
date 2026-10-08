declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FISH_KEY_ENCRYPTION_SECRET?: string;
    SITE_ORIGIN?: string;
  }
}
