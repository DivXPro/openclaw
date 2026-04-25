export {
  normalizeOptionalString,
  normalizeLowercaseStringOrEmpty,
} from "openclaw/plugin-sdk/text-runtime";

export type { PluginRuntime, OpenClawConfig } from "openclaw/plugin-sdk/runtime-types";

export { safeEqualSecret } from "openclaw/plugin-sdk/browser-security-runtime";
export { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/config-runtime";
