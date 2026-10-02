interface SessionView {
  live: boolean;
  state: string;
}

/** Resolve a send against both the rendered views and newly accepted creations. */
export async function resolveSessionTarget(
  id: string | null | undefined,
  picked: SessionView | undefined,
  newborn: Set<string>,
  start: (resume?: string, name?: string) => Promise<string>,
  name?: string,
): Promise<string> {
  if (!id) return start(undefined, name);
  if (!picked) return newborn.has(id) ? id : start(undefined, name);
  if (!picked.live || picked.state === "error") {
    const revived = await start(id);
    if (newborn.has(id)) newborn.add(revived);
    return revived;
  }
  return id;
}
