import { allow, denyFor } from "../../src/output.js";
import type { HookOutput } from "../../src/types.js";
import {
  MalformedPayloadError, ParseUnsafeError, InvalidConfigError,
  MissingAuthEnvError, ServiceUnavailableError, ActionDeniedError,
} from "../../src/errors.js";

// Every concrete HookOutput envelope the hook can emit. (Codex has no `ask`; an
// unmapped call abstains with no envelope, so there is nothing to enumerate here
// for that path.)
export function allOutputFactoryResults(): HookOutput[] {
  return [
    allow(),
    denyFor(new MalformedPayloadError("x")),
    denyFor(new ParseUnsafeError("x")),
    denyFor(new InvalidConfigError("x")),
    denyFor(new MissingAuthEnvError("x")),
    denyFor(new ServiceUnavailableError("x")),
    denyFor(new ActionDeniedError("x")),
  ];
}
