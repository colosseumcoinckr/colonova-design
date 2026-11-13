/** 2026-11-12 UI 조사 U-130 — 가장 나중에 연 팝 하나만 Esc 를 받는다. */
export function createPopoverStack<T>() {
  const entries: Array<{ node: T; close: () => void }> = [];
  return {
    add(node: T, close: () => void, keeps: (other: T) => boolean = () => false) {
      for (const other of [...entries]) {
        if (!keeps(other.node)) {
          entries.splice(entries.indexOf(other), 1);
          other.close();
        }
      }
      const entry = { node, close };
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    isTop(node: T) {
      return entries.at(-1)?.node === node;
    },
  };
}
