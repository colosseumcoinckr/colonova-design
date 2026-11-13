import { mapRead, mapWrite } from "../link-map.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type MapRequest = Extract<keyof RequestHandlers, "map.read" | "map.write">;

/** 연결 지도의 읽기와 쓰기를 맡는다(2026-10-24 연결 지도 계획). 쓰기는 연결 레포 파일만 고친다. */
export function mapHandlers(deps: RouterDeps): RequestHandlers<MapRequest> {
  return {
    "map.read": () => mapRead({ registry: deps.registry, machineSetting: deps.machineSetting }),
    "map.write": (message) =>
      mapWrite({ registry: deps.registry, machineSetting: deps.machineSetting }, message.changes),
  };
}
