/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Defaults to the dev proxy (/api). */
  readonly VITE_API_URL?: string;
  /** FAKE bot token used only by the development mock provider. Must match DEV_BOT_TOKEN of the API. */
  readonly VITE_DEV_BOT_TOKEN?: string;
}

interface ImportMetaEnv {
  /** Placeholders until the bot and Mini App exist in BotFather (PRD 7.3 #7). */
  readonly VITE_BOT_USERNAME?: string;
  readonly VITE_MINI_APP_SHORT_NAME?: string;
}
