export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT: string;
  DASHBOARD_ORIGIN: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL: string;
  NVIDIA_IMAGE_MODEL: string;
  NVIDIA_FREE_ALLOWANCE_REMAINING: string;
  DEV_MOCK_AI: string;
  DEV_TRIGGER_TOKEN?: string;
  FOUNDER_EMAIL?: string;
  FOUNDER_EMAIL_SECRET?: string;
  FOUNDER_PASSWORD_HASH?: string;
  SESSION_SIGNING_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
