/**
 * Approval-bypass opt-out for the hermes-local adapter.
 *
 * --yolo must only reach Hermes when adapterConfig.dangerouslyBypassApprovals
 * is the literal boolean true, and must never be passed more than once or be
 * injectable through extraArgs.
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    runChildProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
    })),
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
}));

import { execute } from "./execute.js";
import * as serverUtils from "@paperclipai/adapter-utils/server-utils";

function makeCtx(overrides: Record<string, unknown> = {}) {
  const onLog = vi.fn(async () => undefined);
  return {
    ctx: {
      runId: "test-run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "/usr/bin/hermes",
        // Explicit provider skips ~/.hermes/config.yaml detection.
        provider: "openrouter",
        timeoutSec: 60,
        graceSec: 5,
        ...overrides,
      },
      context: {
        issueId: "issue-1",
        wakeReason: "manual",
        paperclipWake: null,
      },
      onLog,
      onMeta: vi.fn(async () => undefined),
      onSpawn: vi.fn(async () => undefined),
    } satisfies Record<string, unknown>,
    onLog,
  };
}

async function spawnedArgs(overrides: Record<string, unknown> = {}) {
  const { ctx, onLog } = makeCtx(overrides);
  await execute(ctx as any);
  const call = vi.mocked(serverUtils.runChildProcess).mock.calls.at(-1)!;
  const logs = onLog.mock.calls.map((entry) => String((entry as unknown[])[1]));
  return {
    args: call[2] as string[],
    env: (call[3] as { env: Record<string, string> }).env,
    logs,
  };
}

const yoloCount = (args: string[]) => args.filter((arg) => arg === "--yolo").length;
const YOLO_FORMS = ["--y", "--yo", "--yol", "--yolo", "--yolo=true"];

describe("hermes-local adapter approval bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not pass --yolo when the setting is absent", async () => {
    const { args } = await spawnedArgs();
    expect(yoloCount(args)).toBe(0);
  });

  it("does not pass --yolo when dangerouslyBypassApprovals is false", async () => {
    const { args } = await spawnedArgs({ dangerouslyBypassApprovals: false });
    expect(yoloCount(args)).toBe(0);
  });

  it("strips every argparse abbreviation of --yolo from extraArgs when bypass is off", async () => {
    const { args, logs } = await spawnedArgs({ extraArgs: [...YOLO_FORMS, "--verbose-extra"] });
    for (const form of YOLO_FORMS) expect(args).not.toContain(form);
    expect(args).toContain("--verbose-extra");
    expect(logs.some((line) => line.includes("ignored --yolo from extraArgs"))).toBe(true);
  });

  it("removes configured and inherited HERMES_YOLO_MODE when bypass is off", async () => {
    vi.stubEnv("HERMES_YOLO_MODE", "1");
    const { env } = await spawnedArgs({ env: { HERMES_YOLO_MODE: "true" } });
    expect(env).not.toHaveProperty("HERMES_YOLO_MODE");
  });

  it("passes --yolo exactly once when dangerouslyBypassApprovals is true", async () => {
    const { args } = await spawnedArgs({ dangerouslyBypassApprovals: true });
    expect(yoloCount(args)).toBe(1);
  });

  it("strips --yolo from extraArgs and logs a warning when bypass is false", async () => {
    const { args, logs } = await spawnedArgs({
      dangerouslyBypassApprovals: false,
      extraArgs: ["--yolo", "--reasoning-effort", "low"],
    });
    expect(yoloCount(args)).toBe(0);
    expect(args).toEqual(expect.arrayContaining(["--reasoning-effort", "low"]));
    expect(logs.some((line) => line.includes("ignored --yolo from extraArgs"))).toBe(true);
  });

  it("does not treat the string \"true\" as enabling bypass", async () => {
    const { args } = await spawnedArgs({ dangerouslyBypassApprovals: "true" });
    expect(yoloCount(args)).toBe(0);
  });

  it("passes --yolo exactly once when bypass is true and extraArgs also contains it", async () => {
    const { args, logs } = await spawnedArgs({
      dangerouslyBypassApprovals: true,
      extraArgs: ["--yolo"],
    });
    expect(yoloCount(args)).toBe(1);
    expect(logs.some((line) => line.includes("ignored --yolo from extraArgs"))).toBe(false);
  });
});
