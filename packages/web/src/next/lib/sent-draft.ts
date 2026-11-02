/** 실패한 글과 첨부를 돌려놓되, 기다리며 새로 쓴 말도 보존한다. */
export function restoreRejectedDraft<T>(
  sent: { text: string; attachments: T[] },
  current: { text: string; attachments: T[] },
): { text: string; attachments: T[] } {
  return {
    text: current.text ? `${sent.text}${sent.text ? "\n\n" : ""}${current.text}` : sent.text,
    attachments: [...sent.attachments, ...current.attachments],
  };
}
