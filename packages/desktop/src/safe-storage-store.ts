import type { CredentialStore } from "@colonova-design/daemon/credentials";

/**
 * safeStorage 기반 자격 증명 저장소(Keychain/DPAPI). Electron 의
 * safeStorage 인터페이스를 생성자로 주입받아 단위 테스트에서는 가짜로
 * 대체한다. 암호문(base64)은 userData 의 credentials.json 하나에 모은다 —
 * 렌더러로는 절대 나가지 않는다.
 */
export interface SafeStorageLike {
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class SafeStorageCredentialStore implements CredentialStore {
  readonly kind = "keychain" as const;
  /**
   * 저장돼 있는데 복호화가 실패한 항목(2026-10-20 비개발자 mac 설치 검토). 임시 서명(ad-hoc) 앱은
   * 업데이트마다 키체인 허용을 다시 묻고, 거기서 거부하면 저장해 둔 연결 코드를 읽지 못한다. 없는
   * 항목은 세지 않는다 — 메인이 이 수를 보고 상자로 알린다.
   */
  private readonly unreadableItems = new Set<string>();

  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly file: string,
  ) {}

  /** 이번 실행에서 저장돼 있는데 읽지 못한 항목 수. */
  get unreadable(): number {
    return this.unreadableItems.size;
  }

  async save(item: string, secret: string): Promise<void> {
    const entries = this.read();
    entries[item] = this.safeStorage.encryptString(secret).toString("base64");
    this.write(entries);
    this.unreadableItems.delete(item);
  }

  async load(item: string): Promise<string | null> {
    const blob = this.read()[item];
    if (!blob) return null;
    try {
      const secret = this.safeStorage.decryptString(Buffer.from(blob, "base64"));
      this.unreadableItems.delete(item);
      return secret;
    } catch {
      // 키체인 키가 바뀌거나 허용을 거부하면 복호화가 실패한다 — 없던 것으로 취급하되 센다.
      this.unreadableItems.add(item);
      return null;
    }
  }

  async delete(item: string): Promise<void> {
    const entries = this.read();
    delete entries[item];
    this.write(entries);
    this.unreadableItems.delete(item);
  }

  /** 모든 항목을 지운다(테스트 정리용). */
  clear(): void {
    this.write({});
  }

  private read(): Record<string, string> {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      // 손으로 고친 파일이 객체가 아니면 빈 지도로 본다 — 원시값은 저장 때
      // TypeError, 배열은 항목이 JSON.stringify 에서 조용히 증발한다.
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

  private write(entries: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.colonova-design-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, this.file);
  }
}

// node: 모듈을 지연 import — Electron 메인 번들에서도 그대로 돈다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
