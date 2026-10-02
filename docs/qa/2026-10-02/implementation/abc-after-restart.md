# [구현 검증 A] 파일·화면·설정 변경과 제출 없이 정확히 “구현 응답 A”만 답해주세요.

- 내보낸 시각: 2026. 10. 2. 오후 6:00:23

**나**

[구현 검증 A] 파일·화면·설정 변경과 제출 없이 정확히 “구현 응답 A”만 답해주세요.

**AI**

구현 응답 A

---

**나**

[구현 검증 B] 파일·화면·설정 변경과 제출 없이 정확히 “구현 응답 B”만 답해주세요.

**AI**

구현 응답 B

---

**나**

<!-- colonova-design:comments {"screen":"index","note":"[구현 검증 C] 선택한 곳은 변경하지 말고 정확히 “구현 응답 C”만 답해주세요. 파일·화면·설정 변경과 제출은 하지 마세요.","items":[{"id":"0505eed7-d098-42b9-95b0-9a69d2c2406b","label":"서비스를선택하세요","comment":"[구현 검증 C] 수정하지 마세요.","shot":true}]} -->
[구현 검증 C] 선택한 곳은 변경하지 말고 정확히 “구현 응답 C”만 답해주세요. 파일·화면·설정 변경과 제출은 하지 마세요.

아래는 사용자가 가리킨 자리입니다 — 사용자의 말대로 해 주세요.

1. h1 — "서비스를선택하세요"
   파일 후보: app/select-system/select-system-screen.tsx
   파일 발췌 app/select-system/select-system-screen.tsx 16-76줄:
   /* 심볼과 "colo NOVA" 글자가 한 장에 든 로고 (586×111). 카드 배경이 흰색이라
    * LNB 처럼 반전시킬 필요는 없다 — §`app/shell/shell.css` 의 `.shell-lnb__brand-logo` */
   const LOGO = "/assets/logo.png";
   
   /* 카드 일러스트는 원본의 3D 렌더 아이콘(128×128 webp)을 `public/assets/` 에 받아 쓴다.
    * 전에 두었던 대체 SVG 는 이 파일에서 뺐다. */
   const SYSTEMS = [
     {
       key: "oms",
       title: "OMS",
       desc: "주문관리 시스템",
       to: "/oms/oms-dashboard/dashboard",
       icon: "/assets/ico-service-oms.webp",
     },
     {
       key: "wms",
       title: "WMS",
       desc: "창고관리 시스템",
       to: "/wms/wms-inbound-list",
       icon: "/assets/ico-service-wms.webp",
     },
     {
       key: "setting",
       title: "Setting",
       desc: "시스템 설정",
       to: "/setting/set-perm-role",
       icon: "/assets/ico-service-settings.webp",
     },
   ];
   
   export function SelectSystemScreen() {
     return (
       /* Pretendard 는 루트의 app/fonts.css 가 전역으로 건다 — 원본이 이 화면에서만
          걸던 CDN 스타일시트는 없다. */
       <main
         className="colo-auth flex h-dvh w-dvw items-center justify-center bg-cover bg-center bg-no-repeat"
         style={{ backgroundImage: `url(${BG})` }}
       >
         <div className="flex h-[30rem] w-[64rem] gap-8 rounded-xl bg-white px-10 py-12 shadow-md">
           <aside className="flex w-44 flex-col">
             <Image src={LOGO} alt="colo NOVA" width={586} height={111} priority className="h-auto w-full" />
   
             <h1 className="mt-5 text-2xl leading-8 font-bold text-[var(--color-text-static)]">
               서비스를
               <br />
               선택하세요
             </h1>
   
             <Chip variant="solid" intent="basic" size="medium" shape="box" className="mt-3">
               admin@colosseum.kr
             </Chip>
   
             <Button asChild variant="destructive" className="mt-auto">
               <Link href="/signin">로그아웃</Link>
             </Button>
           </aside>
   
           <div className="grid flex-1 grid-cols-3 gap-6">
             {SYSTEMS.map((s) => (
               <Link
                 key={s.key}
   [구현 검증 C] 수정하지 마세요.
   컴포넌트: SelectSystemScreen
   위치: body > main > div > aside > h1 (rect 60,308 176×64)
   xpath: /body/main/div/aside/h1
   접근성: role heading
   주변: 서비스를 선택하세요 admin@colosseum.kr 로그아웃 OMS 주문관리 시스템 바로가기 WMS 창고관리 시스템 바로가기 Setting 시스템 설정 바로가기
   스타일: color rgb(31, 42, 68) · background-color rgba(0, 0, 0, 0) · font-family "Pretendard Variable", Pretendard, -apple-system, "system-ui", system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif · font-size 24px · font-weight 700 · line-height 32px
   HTML: <h1 class="mt-5 text-2xl leading-8 font-bold text-[var(--color-text-static)]">서비스를<br>선택하세요</h1>

**AI**

구현 응답 C

---