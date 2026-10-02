/** 마지막 프로젝트 삭제가 시작되거나 실패했을 때 Shell 에 빈 화면 상태를 알린다. */
const bus = new EventTarget();

export function setEmptyAfterProjectRemoval(empty: boolean): void {
  bus.dispatchEvent(new CustomEvent("project-empty-mode", { detail: empty }));
}

export function onProjectEmptyModeChange(listener: (empty: boolean) => void): () => void {
  const onChange = (event: Event) => listener((event as CustomEvent<boolean>).detail);
  bus.addEventListener("project-empty-mode", onChange);
  return () => bus.removeEventListener("project-empty-mode", onChange);
}
