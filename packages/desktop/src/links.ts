import { RELEASES_REPO } from "@colonova-design/protocol";

/**
 * 도움말 메뉴의 `사용 설명서 열기` 가 기본 브라우저로 여는 곳(2026-10-08 베타 준비 분석) — 레포의 `docs/GUIDE.md` 를
 * GitHub 가 그려 준다. 소개 페이지(`site/`)에는 설명서 쪽이 없다. 레포 이름은 릴리스 피드가 쓰는 한 곳
 * (`RELEASES_REPO`)에서 온다 — 레포가 옮겨 가면 같이 따라간다. 레포가 공개가 아니면 설치하지 않은 사람에게는
 * 열리지 않으니 그때는 이 한 줄을 소개 페이지 주소로 바꾼다. https 한 주소라 OS 에 그대로 넘겨도 된다(시험이 지킨다).
 */
export const GUIDE_URL = `https://github.com/${RELEASES_REPO}/blob/main/docs/GUIDE.md`;
