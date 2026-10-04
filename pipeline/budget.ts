import { randomUUID } from "node:crypto";
import {
  type FileHandle,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";

export const BUDGET_USD = 10;
export type BudgetEntry = {
  fingerprint: string;
  reservedUsd: number;
  costUsd: number | null;
};
type Reservation = BudgetEntry & { fresh: boolean };
type Ledger = {
  version: 1;
  entries: Record<string, BudgetEntry>;
  handedOff?: boolean;
  remainingUsd?: number;
};

export async function writeDurableJson(
  path: string,
  value: unknown,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function fileCode(error: unknown): string | null {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
function money(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
async function readLedger(path: string): Promise<Ledger> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (fileCode(error) === "ENOENT") return { version: 1, entries: {} };
    throw error;
  }
  const value = JSON.parse(text) as Ledger;
  if (
    value?.version !== 1 ||
    !value.entries ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries) ||
    (value.handedOff !== undefined && value.handedOff !== true) ||
    (value.handedOff &&
      (!money(value.remainingUsd) || value.remainingUsd > BUDGET_USD)) ||
    !Object.values(value.entries).every(
      (entry) =>
        entry &&
        typeof entry.fingerprint === "string" &&
        money(entry.reservedUsd) &&
        (entry.costUsd === null || money(entry.costUsd)),
    )
  )
    throw new Error("予算台帳が不正です。自動で初期化しません。");
  return value;
}

export class BudgetLedger {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  private async update<T>(run: (ledger: Ledger) => T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    let lock: FileHandle;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (fileCode(error) === "EEXIST")
        throw new Error(
          "予算台帳は使用中です。終了したプロセスのロックは確認してから手動で解除してください。",
        );
      throw error;
    }
    try {
      const ledger = await readLedger(this.path);
      const result = run(ledger);
      await writeDurableJson(this.path, ledger);
      return result;
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  async reserve(
    key: string,
    fingerprint: string,
    reservedUsd: number,
  ): Promise<Reservation> {
    if (!key || !fingerprint || !money(reservedUsd) || reservedUsd === 0)
      throw new Error("予算予約の入力が不正です。");
    return this.update((ledger) => {
      const existing = Object.hasOwn(ledger.entries, key)
        ? ledger.entries[key]
        : undefined;
      if (existing) {
        if (
          existing.fingerprint !== fingerprint ||
          existing.reservedUsd !== reservedUsd
        )
          throw new Error(
            "同じジョブの入力が変わっています。既存の予約を上書きしません。",
          );
        return { ...existing, fresh: false };
      }
      if (ledger.handedOff)
        throw new Error(
          "予算は backend へ引き継ぎ済みです。PoC の新しい API 呼び出しは行いません。",
        );
      const total = Object.values(ledger.entries).reduce(
        (sum, entry) => sum + (entry.costUsd ?? entry.reservedUsd),
        0,
      );
      if (total + reservedUsd > BUDGET_USD + 1e-9)
        throw new Error(
          "累積 $10 の予算を超えるため、API 呼び出しを停止しました。未確定の予約も支出として数えます。",
        );
      if (
        Object.values(ledger.entries).some(
          (entry) =>
            entry.costUsd !== null && entry.costUsd > entry.reservedUsd,
        )
      )
        throw new Error(
          "実料金が予約額を超えたため、予算の見積もりを確認するまで API 呼び出しを停止しました。",
        );
      const entry = { fingerprint, reservedUsd, costUsd: null };
      ledger.entries = { ...ledger.entries, [key]: entry };
      return { ...entry, fresh: true };
    });
  }
  async settle(
    key: string,
    fingerprint: string,
    costUsd: number,
  ): Promise<void> {
    if (!money(costUsd)) throw new Error("確定料金が不正です。");
    await this.update((ledger) => {
      const entry = Object.hasOwn(ledger.entries, key)
        ? ledger.entries[key]
        : undefined;
      if (!entry || entry.fingerprint !== fingerprint)
        throw new Error("料金に対応する予約がありません。");
      if (entry.costUsd !== null && entry.costUsd !== costUsd)
        throw new Error("確定済み料金を上書きしません。");
      entry.costUsd = costUsd;
    });
  }
  async handoff(): Promise<number> {
    return this.update((ledger) => {
      if (ledger.handedOff) return ledger.remainingUsd as number;
      const committed = Object.values(ledger.entries).reduce(
        (sum, entry) => sum + (entry.costUsd ?? entry.reservedUsd),
        0,
      );
      const remainingUsd =
        Math.floor(Math.max(0, BUDGET_USD - committed) * 1_000_000) / 1_000_000;
      ledger.handedOff = true;
      ledger.remainingUsd = remainingUsd;
      return remainingUsd;
    });
  }
}
