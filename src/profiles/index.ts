import type { Profile } from "./profile.js";
import { pythonProfile } from "./python.js";
import { rustProfile } from "./rust.js";
import { cProfile } from "./c.js";
import { typescriptProfile } from "./typescript.js";
import { wasmProfile } from "./wasm.js";
import { swiftProfile } from "./swift.js";

export const profiles: readonly Profile[] = [swiftProfile, rustProfile, cProfile, typescriptProfile, wasmProfile, pythonProfile];

export function profileById(id: string): Profile | undefined {
  return profiles.find((p) => p.id === id);
}

export type { Profile } from "./profile.js";
