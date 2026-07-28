/// <reference types="vite/client" />

// vite env typing for dashboard api configuration
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
