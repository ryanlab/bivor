import type { BivorApi } from "./index";

declare global {
  interface Window {
    pi: BivorApi;
  }
}

export {};
