import {
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  CornerDownLeft,
  Download,
  House,
  Info,
  Keyboard,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageSquare,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Settings,
  Smartphone,
  Sparkle,
  SquareDashed,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  X,
} from "lucide-react";

/**
 * 새 셸의 그림 한 곳 — 목업의 선 굵기(1.8)와 크기(12~16px)를 여기서 정한다.
 * 모두 장식이다(aria-hidden): 누르는 요소는 자기 이름을 따로 단다.
 */
function make(Glyph: LucideIcon, size: number, strokeWidth = 1.8) {
  return function Icon() {
    return <Glyph className="nx-i" size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  };
}

export const PlusIcon = make(Plus, 16);
export const HomeIcon = make(House, 16);
export const SearchIcon = make(Search, 16);
export const GearIcon = make(Settings, 16);
export const MenuIcon = make(Menu, 17);
export const PanelIcon = make(PanelLeft, 16);
export const PencilIcon = make(Pencil, 13, 2);
export const ChevronDownIcon = make(ChevronDown, 14, 2);
export const ChevronRightIcon = make(ChevronRight, 12, 2);
/** 고르는 상자의 오른쪽 끝 — 프로젝트 전환기가 쓴다(2026-10-06). */
export const ChevronsUpDownIcon = make(ChevronsUpDown, 14, 2);
export const CheckIcon = make(Check, 14, 2.2);
export const KeyboardIcon = make(Keyboard, 17, 1.8);
export const AlertIcon = make(TriangleAlert, 26, 1.7);
export const CloseIcon = make(X, 14, 2);
export const CalmIcon = make(CircleCheck, 16);
export const SendIcon = make(ArrowUp, 16, 2.2);
export const SparkIcon = make(Sparkle, 14);
/** 사이드바 바닥의 기능 제안 · 프로젝트 목록의 정보 줄(2026-10-06). */
export const LightbulbIcon = make(Lightbulb, 15);
export const InfoIcon = make(Info, 15);

/** 홈 입력창 아래의 시작점 칩 — 요청의 종류마다 하나(2026-10-06 홈 개선). */
export const StarterWordsIcon = make(Type, 14);
export const StarterEmptyIcon = make(SquareDashed, 14);
export const StarterPhoneIcon = make(Smartphone, 14);
export const StarterTidyIcon = make(AlignVerticalSpaceAround, 14);
/** 홈 줄의 앞 그림 — 이어서 할 대화 · 끌어다 놓기 덮개. */
export const ChatLineIcon = make(MessageSquare, 15);
export const DropIcon = make(Upload, 18);
/** 대화 줄 `···` 메뉴의 줄 그림 — 내보내기 · 지우기(2026-10-06 겹판 조사). */
export const DownloadIcon = make(Download, 14);
export const TrashIcon = make(Trash2, 14);

/** 키캡 안의 글리프 — 찾기 창 바닥의 키 안내(↑↓ · ↵). 글자 화살표는 폰트마다 크기와 무게가 달라 그림으로 그린다. */
export const KeyUpIcon = make(ArrowUp, 11, 2.2);
export const KeyDownIcon = make(ArrowDown, 11, 2.2);
export const KeyEnterIcon = make(CornerDownLeft, 11, 2.2);

/** 도는 표식 — 목업의 `.spin.sm`. */
export function Spin() {
  return <i className="nx-spin" aria-hidden="true" />;
}
