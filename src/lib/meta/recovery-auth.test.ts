import { describe, expect, it } from "vitest";
import { isRecoveryAuthorized } from "./recovery-auth";

describe("Purchase recovery authentication", () => {
  const secret = "recovery-test-only-secret-at-least-32-characters";
  it("requires the exact server-only bearer secret", async () => {
    expect(await isRecoveryAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(await isRecoveryAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(await isRecoveryAuthorized(null, secret)).toBe(false);
  });
  it("fails closed without a configured strong secret", async () => {
    expect(await isRecoveryAuthorized("Bearer public", undefined)).toBe(false);
    expect(await isRecoveryAuthorized("Bearer short", "short")).toBe(false);
  });
});