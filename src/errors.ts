export type DenyCode =
  | "malformed_payload"
  | "parse_unsafe"
  | "invalid_config"
  | "missing_auth_env"
  | "service_unavailable"
  | "action_denied";

export abstract class HookError extends Error {
  abstract readonly code: DenyCode;
}

export class MalformedPayloadError extends HookError {
  readonly code = "malformed_payload" as const;
}
export class ParseUnsafeError extends HookError {
  readonly code = "parse_unsafe" as const;
}
export class InvalidConfigError extends HookError {
  readonly code = "invalid_config" as const;
}
export class MissingAuthEnvError extends HookError {
  readonly code = "missing_auth_env" as const;
}
export class ServiceUnavailableError extends HookError {
  readonly code = "service_unavailable" as const;
}
export class ActionDeniedError extends HookError {
  readonly code = "action_denied" as const;
}
