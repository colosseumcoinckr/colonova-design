import "@xyflow/react/dist/style.css";
import {
  type Connection,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { MapChange, MapReadResult } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { Spin } from "../../ui/icons";
import { buildMapGraph, connectionToAdd, edgeIdToChange, type MapNodeModel } from "./map-groups";

/**
 * 연결 지도 보기(F6 2조각) — 기획서 칸 안의 @xyflow/react 그림. 왼쪽 문서 · 오른쪽 화면을
 * 묶음 순서대로 세로로 세우고(배치는 map-groups 의 결정적 조립) 연결을 선으로 잇는다.
 * 문서 노드의 오른쪽 손잡이에서 화면 노드의 왼쪽 손잡이로 끌면 잇고, 고른 연결을 끊는다.
 * 노드 옮김은 못 하게(그림 안정) 화면 이동 · 줌 · 미니맵은 켠다.
 */

type MapFlowNode = Node<{ model: MapNodeModel }, "map">;

const NODE_TYPES = { map: GraphNode } as const;

function GraphNode({ data }: NodeProps<MapFlowNode>) {
  const model = data.model;
  return (
    <div className={`nx-map-node nx-map-node--${model.kind}`}>
      {/* 잇기의 손잡이 — 문서는 오른쪽에서 나가고 화면은 왼쪽으로 들어온다. */}
      {model.kind === "doc" ? <Handle type="source" position={Position.Right} /> : null}
      {model.kind === "screen" ? <Handle type="target" position={Position.Left} /> : null}
      <span className="nx-map-node-text">
        <span className="nx-map-node-t">
          {model.kind === "goneDoc"
            ? L.plans.mapGoneDoc
            : model.kind === "goneScreen"
              ? L.plans.mapGoneScreen
              : model.label}
        </span>
        {model.sub !== undefined && <span className="nx-map-node-sub">{model.sub}</span>}
      </span>
      {model.kind === "screen" && model.observed ? (
        <span className="nx-map-observed">{L.plans.mapObserved}</span>
      ) : null}
      {model.kind === "goneScreen" && model.route !== undefined ? (
        <span className="nx-map-node-sub">{model.route}</span>
      ) : null}
    </div>
  );
}

export function PlansMap({
  result,
  phase,
  onRefresh,
  onWrite,
  onOpenDoc,
}: {
  result: MapReadResult | null;
  phase: "idle" | "loading" | "ready" | "failed";
  onRefresh: () => void;
  /** 잇기·끊기 — 쓴 뒤의 연결 목록 전체로 상태를 갈아끼운다. 거절은 예외로 돌아온다. */
  onWrite: (changes: readonly MapChange[]) => Promise<void>;
  onOpenDoc: (pageId: string) => void;
}) {
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writingRef = useRef(false);
  const [writing, setWriting] = useState(false);

  const graph = useMemo(() => (result === null ? null : buildMapGraph(result)), [result]);
  const nodes = useMemo<MapFlowNode[]>(
    () =>
      (graph?.nodes ?? []).map((model) => ({
        id: model.id,
        type: "map",
        position: { x: model.x, y: model.y },
        data: { model },
        draggable: false,
      })),
    [graph],
  );
  const edges = useMemo<Edge[]>(
    () =>
      (graph?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.label === null ? {} : { label: edge.label }),
      })),
    [graph],
  );

  const apply = useCallback(
    (changes: readonly MapChange[]) => {
      if (writingRef.current || changes.length === 0) return;
      writingRef.current = true;
      setWriting(true);
      setWriteError(null);
      onWrite(changes)
        .catch((error: unknown) => {
          // 거절 문장은 데몬이 한국어로 지어 보낸다 — 그대로 보인다.
          setWriteError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          writingRef.current = false;
          setWriting(false);
        });
    },
    [onWrite],
  );

  if (phase === "idle" || phase === "loading")
    return (
      <div className="nx-map-note" role="status">
        {phase === "loading" ? <Spin /> : null}
        {L.plans.mapLoading}
      </div>
    );
  if (phase === "failed" || result === null)
    return (
      <div className="nx-map-note">
        <p>{L.plans.mapFailed}</p>
        <button type="button" className="nx-map-retry" onClick={onRefresh}>
          {L.plans.mapRefresh}
        </button>
      </div>
    );

  const unlink = (edgeId: string) => {
    const change = edgeIdToChange(edgeId);
    setSelectedEdge(null);
    if (change !== null) apply([change]);
  };

  return (
    <div className="nx-map">
      <div className="nx-map-head">
        <p>
          {result.links.length === 0
            ? L.plans.mapNoLinks
            : L.plans.mapLinksCount(result.links.length)}
        </p>
        {selectedEdge !== null ? (
          <button
            type="button"
            className="nx-map-retry"
            disabled={writing}
            onClick={() => unlink(selectedEdge)}
          >
            {L.plans.mapUnlink}
          </button>
        ) : null}
        <p className="nx-map-hint">{L.plans.mapHint}</p>
        {/* Confluence 미연결 — 기획서 칸의 연결 안내 말을 그대로 쓴다. */}
        {!result.linked && <p className="nx-map-hint">{L.plans.emptyNoneBody}</p>}
        {writeError !== null ? (
          <p className="nx-map-hint">
            {L.plans.mapWriteFailed} — {writeError}
          </p>
        ) : null}
      </div>
      {/* 그림판은 머리 줄의 형제로 선다 — 머리(flex 행) 안에 두면 줄의 크기를 따라 220px 에 눌린다. */}
      <ReactFlow
        className="nx-map-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        elementsSelectable={true}
        deleteKeyCode={["Delete", "Backspace"]}
        minZoom={0.1}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        onNodeDoubleClick={(_, node) => {
          // 한 번 눌러 문서를 여니 잇기 끌기가 몸통에 빗나갈 때마다 지도가 사라졌다 — 두 번 누르기로만 연다(2026-10-24 사용자 보고).
          const model = node.data.model;
          if (model.kind === "doc" && model.pageId !== undefined) onOpenDoc(model.pageId);
        }}
        connectionRadius={32}
        onConnect={(connection: Connection) => {
          const change = connectionToAdd(connection, graph?.nodes ?? []);
          if (change !== null) apply([change]);
        }}
        onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => setSelectedEdge(null)}
        onEdgesDelete={(removed: Edge[]) => {
          setSelectedEdge(null);
          apply(
            removed.flatMap((edge) => {
              const change = edgeIdToChange(edge.id);
              return change === null ? [] : [change];
            }),
          );
        }}
      >
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
