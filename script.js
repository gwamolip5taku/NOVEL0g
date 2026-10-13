/* ==========================================================================
   NOVELog — 동작 스크립트
   --------------------------------------------------------------------------
   전체 흐름
     1) 왼쪽 패널에서 제목·부제목을 입력하면 미리보기(#canvas-inner)에 그대로 옮기고,
        본문은 마크다운을 HTML로 바꿔서 옮긴다.
     2) 글꼴 선택칸에서 고른 글꼴을 결과 이미지 전체(제목·부제목·본문)에 적용한다.
     3) 이미지를 올리면 글 왼쪽 칸의 배경으로 깔고, 슬라이더로 칸 폭(%)을 정한다.
        미리보기에서 이미지를 마우스(또는 손가락)로 끌면 보이는 위치가 바뀐다.
     4) #canvas-inner는 항상 "설정한 가로 폭(px)"으로 그려 두고,
        미리보기 칸 폭에 맞게 transform: scale()로 줄여서 보여 준다.
     5) "PNG 다운로드"를 누르면 html2canvas 라이브러리로 #canvas-inner를 그림으로 찍어 저장한다.

   모든 처리는 브라우저 안에서만 일어나고, 파일은 어디에도 업로드되지 않는다.

   코드 읽는 순서 추천
     설정값·상태 → 유틸 함수 → 마크다운 변환 → 01 글 → 02 글꼴 → 03 이미지
     → 이미지 끌기 → 미리보기 배율 → PNG 다운로드 → 처음 실행
   ========================================================================== */

// 전체 코드를 (() => { ... })(); 로 감쌌다. "즉시 실행 함수(IIFE)"라고 부른다.
// 함수를 만들자마자 바로 실행하는 형태로, 안에서 만든 변수들이 전역(window)에 새어 나가지 않는다.
// → 다른 스크립트와 변수 이름이 겹쳐도 서로 망가뜨리지 않는다.
(() => {
  // 엄격 모드: 선언하지 않은 변수 사용 같은 흔한 실수를 조용히 넘기지 않고 오류로 알려 준다.
  "use strict";


  // ── 설정값 ────────────────────────────────────────────────────────────
  // const: 다시 바꿀 수 없는 상수. 이름을 대문자로 쓰는 건 "고정 설정값"이라는 관례적 표시다.

  const DEFAULT_WIDTH = 2000;   // 가로 폭 입력칸이 비었거나 이상한 값일 때 쓸 기본 폭(px)
  const MIN_WIDTH = 400;        // 가로 폭 최솟값
  const MIN_FONT_SIZE = 10;     // 글자 크기 최솟값(px)

  // 글 칸의 여백·간격·최소 높이를 "가로 폭에 대한 비율"로 정해 둔다.
  // 예) 가로 2000px → 여백 2000 × (108 / 650) ≈ 332px
  // 비율로 잡았기 때문에 가로 폭을 바꿔도 전체 느낌(여백 비율)은 그대로다.
  // (108, 36, 400은 원래 650px 폭 기준으로 디자인했던 값)
  const LAYOUT = {
    padding: 108 / 650,     // 글 칸 안쪽 여백
    gap: 36 / 650,          // 제목·부제목·본문 사이 간격
    minHeight: 400 / 650,   // 결과 이미지 최소 높이
  };

  // 제목·부제목 미리보기에 남겨 둘 HTML 태그 목록.
  // Set은 "중복 없는 값 모음"이고, .has(값)으로 들어 있는지 빠르게 확인할 수 있다.
  // 여기 없는 태그(<script>, <img>, <a> 등)는 벗겨 내고 안쪽 글자만 남긴다. (아래 copySafe 참고)
  const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "DIV", "P"]);


  // ── 상태(state) ───────────────────────────────────────────────────────
  // 실행 중에 바뀌는 값들을 한 객체에 모아 둔다.
  // 흩어진 변수보다 "지금 프로그램이 어떤 상태인지" 한눈에 보기 쉽다.
  const state = {
    imageUrl: null,             // 올린 이미지를 가리키는 임시 주소("blob:..."). 없으면 null
    imageSize: null,            // 올린 이미지의 원래 크기 { w, h }. 끌기 계산에 필요
    imagePos: { x: 50, y: 50 }, // 이미지 보이는 위치(%). 50, 50 = 가운데
    drag: null,                 // 이미지를 끄는 중이면 시작 정보 객체, 아니면 null
    fontUploads: [],            // 사용자가 올린 글꼴 목록 [{ label, family, src, format }]
    busy: false,                // PNG를 만드는 중이면 true (버튼 중복 클릭 방지)
  };


  // ── DOM 요소 모음 ─────────────────────────────────────────────────────
  // $("id") → document.getElementById("id") 를 짧게 쓰려고 만든 도우미 함수.
  // (id) => ... 는 화살표 함수 문법. function (id) { return ...; } 와 거의 같다.
  const $ = (id) => document.getElementById(id);

  // 자주 쓰는 화면 요소를 처음에 한 번만 찾아서 el 객체에 보관한다.
  // 매번 getElementById로 찾는 것보다 빠르고, 어떤 요소를 쓰는지 한곳에서 볼 수 있다.
  // ⚠ index.html의 id를 바꾸면 여기도 같이 바꿔야 한다.
  const el = {
    // 01 글
    titleInput: $("title-input"), subtitleInput: $("subtitle-input"), bodyInput: $("body-input"),
    titleSize: $("title-size"), subtitleSize: $("subtitle-size"), bodySize: $("body-size"),
    // 02 글꼴
    font: $("font"),
    fileFont: $("file-font"), dropFont: $("drop-font"), mainFont: $("main-font"), metaFont: $("meta-font"),
    // 03 이미지
    fileImg: $("file-img"), dropImg: $("drop-img"), mainImg: $("main-img"), metaImg: $("meta-img"),
    imgRemove: $("img-remove"), imgReset: $("img-reset"),
    imgWidth: $("img-width"), imgWidthValue: $("img-width-value"),
    // 04 크기 + 다운로드
    canvasWidth: $("canvas-width"), download: $("download"), status: $("status"),
    // 미리보기 (querySelector: CSS 선택자로 첫 번째 요소를 찾는다. id가 없는 요소에 사용)
    outSize: $("out-size"), canvas: $("canvas"), inner: $("canvas-inner"),
    imgArea: $("img-area"), imgInner: $("img-inner"), textArea: document.querySelector(".text-area"),
    titlePreview: $("title-preview"), subtitlePreview: $("subtitle-preview"), bodyPreview: $("body-preview"),
  };

  // 제목·부제목은 처리 방식이 똑같아서 [입력칸, 글자 크기 칸, 미리보기] 묶음 배열로 만들어 둔다.
  // → 아래에서 forEach로 두 개를 한 번에 처리할 수 있다 (같은 코드를 두 번 쓰지 않음).
  const PLAIN_FIELDS = [
    { input: el.titleInput,    size: el.titleSize,    preview: el.titlePreview },
    { input: el.subtitleInput, size: el.subtitleSize, preview: el.subtitlePreview },
  ];
  // 본문은 마크다운이라 처리 방식이 달라서 따로 둔다.
  const BODY_FIELD = { input: el.bodyInput, size: el.bodySize, preview: el.bodyPreview };

  // 이미지 드롭존의 처음 안내 문구. 이미지를 "제거"했을 때 원래 문구로 되돌리려고 기억해 둔다.
  const IMG_META_DEFAULT = el.metaImg.textContent;

  // 처음 선택된 글꼴. 형식은 "lib:글꼴이름:굵기" (아래 02 글꼴 참고)
  const INITIAL_FONT = "lib:JeonjuCraftMyungjo:300";


  // ── 유틸(도우미) 함수 ─────────────────────────────────────────────────

  // 숫자 입력칸의 값을 숫자로 읽는다.
  //   · 비었거나 숫자가 아니면 fallback(대체값)을 돌려준다.
  //   · min보다 작으면 min으로 올린다.
  // input.value는 항상 "문자열"이라서 Number()로 숫자로 바꿔야 계산할 수 있다.
  function readNumber(input, fallback, min) {
    const n = Number(input.value);
    // Number.isFinite: 정상적인 숫자인지 (NaN, Infinity가 아닌지) 확인
    if (!input.value || !Number.isFinite(n)) return fallback;
    return Math.max(min, n);   // 둘 중 큰 값 → min보다 작아지지 않음
  }

  // 지금 설정된 가로 폭(px). 함수로 만들어 두면 필요할 때마다 최신 값을 읽을 수 있다.
  const canvasWidth = () => readNumber(el.canvasWidth, DEFAULT_WIDTH, MIN_WIDTH);

  // 값 v를 lo ~ hi 범위 안으로 가둔다. 예) clamp(120, 0, 100) → 100
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // HTML에서 특별한 뜻이 있는 글자를 "그냥 보이는 글자"로 바꾼다.
  //   & → &amp;   < → &lt;   > → &gt;   " → &quot;
  // 이렇게 해야 사용자가 <script> 같은 걸 입력해도 태그로 실행되지 않고 글자로만 보인다. (보안)
  // /&/g 는 정규식: & 를 찾아라, g(global) = 하나만 말고 전부.
  // ⚠ & 를 맨 먼저 바꿔야 한다. 나중에 바꾸면 &lt; 의 & 까지 다시 바뀌어 버린다.
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // source(입력칸) 안의 내용을 target(미리보기)으로 "안전하게" 복사한다.
  //   · ALLOWED_TAGS에 있는 태그만 새로 만들어 넣는다. 속성(onclick=, style= 등)은 전부 버린다.
  //   · 허용하지 않은 태그는 껍데기만 버리고 안쪽 글자는 살린다.
  // 정규식으로 HTML 글자를 고치는 방식보다 안전하다.
  // (브라우저가 이미 해석해 둔 요소 구조를 그대로 따라가며 새로 만들기 때문)
  function copySafe(source, target) {
    target.replaceChildren();   // 미리보기 안을 싹 비운다 (자식 요소 전부 제거)

    // walk: from 안의 노드들을 하나씩 보면서 to 안에 안전한 복사본을 만든다.
    // 태그 안에 태그가 또 있을 수 있어서, 자기 자신을 다시 부르는 "재귀 함수"로 만들었다.
    const walk = (from, to) => {
      // childNodes: 자식 노드 전부 (요소뿐 아니라 글자 덩어리도 포함)
      for (const node of from.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          // 글자 노드 → 글자 그대로 붙인다 (append에 문자열을 주면 글자로 들어감 = 안전)
          to.append(node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // 요소(태그) 노드
          if (ALLOWED_TAGS.has(node.tagName)) {
            // 허용 태그 → 같은 이름의 "속성 없는" 새 요소를 만들어 붙이고, 그 안을 계속 탐색
            const clean = document.createElement(node.tagName);
            to.append(clean);
            walk(node, clean);
          } else {
            // 허용하지 않은 태그 → 태그는 버리고, 안쪽 내용만 현재 위치(to)에 이어서 복사
            walk(node, to);
          }
        }
        // 그 밖의 노드(주석 등)는 무시
      }
    };
    walk(source, target);
  }

  // 제목으로 저장 파일 이름을 만든다. 예) "밤의 도서관!" → "밤의-도서관"
  function fileNameFromTitle() {
    const name = el.titleInput.textContent
      .replace(/[^a-zA-Z0-9가-힣\s_-]/g, "")   // 영문·숫자·한글·공백·_·- 를 "제외한" 글자 전부 삭제 ([^...] = 이것들이 아닌 것)
      .trim()                                   // 앞뒤 공백 제거
      .replace(/\s+/g, "-")                     // 공백 덩어리(\s+)를 - 하나로
      .toLowerCase();                           // 영문은 소문자로
    // A || B: A가 빈 문자열이면 B를 쓴다 → 제목이 없으면 "novelog"
    return name || "novelog";
  }

  // Blob(파일 데이터 덩어리)을 사용자 컴퓨터에 파일로 내려받게 한다.
  // 원리: 보이지 않는 <a download> 링크를 만들어 코드로 클릭한다.
  function saveBlob(blob, fileName) {
    const link = document.createElement("a");
    link.download = fileName;                  // 이 이름으로 저장
    link.href = URL.createObjectURL(blob);     // Blob을 가리키는 임시 주소("blob:...") 만들기
    link.click();
    // 임시 주소는 메모리를 차지하므로, 다운로드가 시작될 시간(1초)을 준 뒤 해제한다.
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // 다운로드 버튼 아래 상태 문구를 바꾼다.
  // isError = false 는 "기본값 매개변수": 두 번째 값을 안 넘기면 false.
  function setStatus(text, isError = false) {
    el.status.textContent = text;
    // classList.toggle(이름, 조건): 조건이 true면 클래스 추가, false면 제거
    el.status.classList.toggle("is-error", isError);
  }


  // ── 마크다운 → HTML 변환 ──────────────────────────────────────────────
  // 외부 라이브러리 없이 직접 만든 작은 변환기. 소설 본문에 필요한 만큼만 지원한다.
  //   블록(줄 단위): 문단, # 제목, - 목록, 1. 번호 목록, > 인용, --- 구분선, ``` 코드 블록
  //   글자(줄 안): **굵게** __굵게__ *기울임* _기울임_ ~~취소선~~ `코드` [글자](주소)
  //
  // 안전: 사용자가 쓴 글자는 전부 escapeHtml로 먼저 바꾼 "뒤에" 태그를 붙인다.
  //       그래서 본문에 HTML을 써도 실행되지 않고 글자로만 보인다.
  //
  // 소설에 맞춘 규칙: 문단 안에서 엔터 한 번은 줄바꿈(<br>)으로 살린다.
  //                  (표준 마크다운은 엔터 한 번을 무시하고 한 줄로 이어 붙인다)

  // 줄의 종류를 알아보는 정규식 모음
  //   ^ = 줄 맨 앞, $ = 줄 맨 끝, \s = 공백, \d = 숫자, * = 0번 이상, + = 1번 이상,
  //   {0,3} = 0~3번, ( ) = 나중에 꺼내 쓸 부분(그룹), [abc] = a·b·c 중 하나
  const MD = {
    fence: /^\s*```/,                              // ``` 로 시작하는 줄 (코드 블록 시작/끝)
    heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,  // "# 제목" → 그룹1: #들, 그룹2: 제목 글자
    hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,          // ---, ***, ___ (같은 기호 3개 이상). \1 = 그룹1과 같은 글자
    quote: /^\s{0,3}>\s?/,                         // > 로 시작하는 줄
    ul: /^\s*[-*+]\s+(.*)$/,                       // "- 항목" → 그룹1: 항목 글자
    ol: /^\s*(\d{1,9})[.)]\s+(.*)$/,               // "1. 항목" → 그룹1: 번호, 그룹2: 항목 글자
  };

  // 이 줄이 "새 블록"(제목, 목록, 인용 등)을 시작하는 줄인지.
  // 문단을 모으다가 이런 줄이 나오면 문단을 끝낸다.
  // .test(문자열): 정규식에 맞으면 true
  const isBlockStart = (line) =>
    MD.fence.test(line) || MD.heading.test(line) || MD.hr.test(line) ||
    MD.quote.test(line) || MD.ul.test(line) || MD.ol.test(line);

  // 한 줄 안의 꾸밈(굵게, 기울임 등)을 HTML로 바꾼다.
  function mdInline(text) {
    // `코드` 안의 글자는 꾸미면 안 된다 (예: `**` 는 굵게가 아니라 기호 그대로).
    // 그래서 먼저 `...` 기준으로 잘라 둔다.
    // split에 그룹이 있는 정규식을 쓰면 잘린 조각 사이에 그룹 내용이 끼어 들어온다:
    //   "a `b` c" → ["a ", "b", " c"]  → 홀수 번째(1, 3, ...) 조각이 코드
    return text.split(/`([^`]+)`/).map((part, i) => {
      // 코드 조각: 글자만 안전하게 바꾸고 <code>로 감싼다
      if (i % 2 === 1) return `<code>${escapeHtml(part)}</code>`;
      // 일반 조각: 먼저 escapeHtml로 안전하게 만든 뒤 꾸밈을 태그로 바꾼다.
      // (.+?) 의 ? 는 "가능한 짧게" → **a** **b** 를 각각 따로 굵게 처리
      // (?=\S) 는 "바로 뒤가 공백이 아니어야 함" → "2 * 3 * 4" 같은 계산식은 기울임이 되지 않음
      // $1, $2 는 정규식 그룹에 걸린 글자
      return escapeHtml(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<u>$1</u>")       // [글자](주소) → 밑줄 글자 (이미지에선 링크를 누를 수 없으니까)
        .replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")   // **굵게**
        .replace(/__(?=\S)(.+?)__/g, "<strong>$1</strong>")       // __굵게__
        .replace(/~~(?=\S)(.+?)~~/g, "<del>$1</del>")             // ~~취소선~~
        .replace(/\*(?=\S)(.+?)\*/g, "<em>$1</em>")               // *기울임* (** 처리 뒤에 해야 헷갈리지 않음)
        // _기울임_ : 앞뒤가 영문·숫자·한글이 아닐 때만. snake_case_name 같은 단어 속 _ 는 건드리지 않는다.
        .replace(/(^|[^\w가-힣])_(?=\S)(.+?)_(?![\w가-힣])/g, "$1<em>$2</em>");
    }).join("");   // 조각들을 다시 하나의 문자열로 이어 붙임
  }

  // 마크다운 전체를 HTML 문자열로 바꾼다.
  // 방식: 줄 배열을 위에서부터 읽으면서(i = 현재 줄 번호) 블록 종류를 판단하고,
  //       블록 하나를 다 읽으면 그 HTML을 out 배열에 넣는다.
  function markdownToHtml(md) {
    // 줄바꿈 기호 통일: 윈도우(\r\n), 옛 맥(\r) → \n. 그다음 줄 단위로 나눈다.
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const out = [];   // 완성된 블록 HTML들
    let i = 0;        // 지금 읽고 있는 줄 번호 (let: 바뀌는 변수)

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄: 블록 사이 구분일 뿐이라 건너뛴다. continue = 반복문 처음으로
      if (!line.trim()) { i++; continue; }

      // ``` 코드 블록: 닫는 ``` 가 나올 때까지 모든 줄을 꾸밈 없이 그대로 모은다
      if (MD.fence.test(line)) {
        const code = [];
        i++;   // 여는 ``` 줄 건너뜀
        // lines[i++]: 현재 줄을 쓰고 나서 i를 1 늘린다 (후위 증가)
        while (i < lines.length && !MD.fence.test(lines[i])) code.push(lines[i++]);
        i++;   // 닫는 ``` 줄 건너뜀
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      // # 제목. match는 맞으면 [전체, 그룹1, 그룹2, ...] 배열, 안 맞으면 null
      const h = line.match(MD.heading);
      if (h) {
        // # 개수 = 제목 단계. ####부터는 h3 크기로 맞춘다 (CSS에 h1~h3만 있음)
        const level = Math.min(h[1].length, 3);
        out.push(`<h${level}>${mdInline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      // --- 구분선. "- " 목록보다 먼저 검사해야 한다 ("- - -"는 목록이 아니라 구분선)
      if (MD.hr.test(line)) { out.push("<hr>"); i++; continue; }

      // > 인용: 이어지는 > 줄들을 모아서 > 를 떼어 낸 뒤,
      //         그 안쪽을 다시 markdownToHtml로 변환한다 (재귀 → 인용 안에 목록 등도 가능)
      if (MD.quote.test(line)) {
        const inner = [];
        while (i < lines.length && MD.quote.test(lines[i])) inner.push(lines[i++].replace(MD.quote, ""));
        out.push(`<blockquote>${markdownToHtml(inner.join("\n"))}</blockquote>`);
        continue;
      }

      // 목록 (- 순서 없음 / 1. 번호)
      const ordered = MD.ol.test(line);    // 번호 목록인가?
      if (ordered || MD.ul.test(line)) {
        // 조건 ? A : B → 조건이 참이면 A, 거짓이면 B (삼항 연산자)
        const re = ordered ? MD.ol : MD.ul;
        // 번호 목록은 첫 번호부터 시작 (3. 으로 시작하면 3부터)
        const start = ordered ? Number(line.match(MD.ol)[1]) : 1;
        const items = [];
        // 같은 종류의 항목 줄이 이어지는 동안 반복
        while (i < lines.length && re.test(lines[i])) {
          const m = lines[i++].match(re);
          // 번호 목록은 글자가 그룹2, 일반 목록은 그룹1
          const parts = [mdInline(ordered ? m[2] : m[1])];
          // 항목 바로 다음 줄이 빈 줄도, 새 블록도 아니면 → 같은 항목 안의 줄바꿈으로 본다
          while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) parts.push(mdInline(lines[i++].trim()));
          items.push(`<li>${parts.join("<br>")}</li>`);
        }
        const tag = ordered ? "ol" : "ul";
        // 1이 아닌 번호로 시작할 때만 start="3" 속성을 붙인다
        const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
        out.push(`<${tag}${startAttr}>${items.join("")}</${tag}>`);
        continue;
      }

      // 위 어디에도 해당하지 않으면 → 문단
      // 빈 줄이나 새 블록이 나올 때까지 줄을 모으고, 줄 사이는 <br>로 잇는다.
      // (para.length && ...) : 문단의 첫 줄은 무조건 넣고, 두 번째 줄부터 새 블록인지 검사
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) {
        para.push(mdInline(lines[i++]));
      }
      out.push(`<p>${para.join("<br>")}</p>`);
    }

    return out.join("");
  }


  // ── 01 글 ─────────────────────────────────────────────────────────────

  // 제목·부제목 입력칸 내용을 미리보기로 옮긴다
  function renderPlain(field) {
    copySafe(field.input, field.preview);
    // 입력칸을 다 지워도 브라우저가 <br> 하나를 남기는 경우가 있다.
    // 글자가 하나도 없으면 완전히 비워서, CSS의 :empty 규칙으로 숨겨지게 한다.
    // (그래야 빈 칸이 간격을 차지하지 않고, 입력칸의 안내 문구도 다시 보인다)
    if (!field.preview.textContent.trim()) field.preview.replaceChildren();
    if (!field.input.textContent.trim()) field.input.replaceChildren();
  }

  // 본문(마크다운)을 HTML로 바꿔서 미리보기에 넣는다.
  // innerHTML에 문자열을 넣으면 HTML로 해석된다. markdownToHtml이 사용자 글자를 전부
  // escapeHtml로 처리했기 때문에 안전하다.
  function renderBody() {
    el.bodyPreview.innerHTML = markdownToHtml(el.bodyInput.value);
  }

  // 글자 크기 입력값을 미리보기에 적용 (style.fontSize는 "70px"처럼 단위까지 문자열로)
  function renderFontSize(field) {
    field.preview.style.fontSize = readNumber(field.size, MIN_FONT_SIZE, MIN_FONT_SIZE) + "px";
  }

  // 제목·부제목 각각에 이벤트 연결
  // addEventListener(이벤트 이름, 실행할 함수): 그 일이 일어날 때마다 함수를 실행한다
  //   "input": 입력칸 내용이 바뀔 때마다 (글자 하나 칠 때마다)
  PLAIN_FIELDS.forEach((field) => {
    field.input.addEventListener("input", () => renderPlain(field));
    field.size.addEventListener("input", () => renderFontSize(field));

    // 붙여넣기 할 때 "글자만" 넣는다.
    // 웹페이지 등에서 복사한 글은 글꼴·색·크기 같은 서식이 딸려 와서 결과가 엉망이 되기 쉽다.
    field.input.addEventListener("paste", (e) => {
      e.preventDefault();                                  // 브라우저 기본 붙여넣기 막기
      const text = e.clipboardData.getData("text/plain");  // 클립보드에서 순수 글자만 꺼내기
      document.execCommand("insertText", false, text);     // 커서 위치에 글자 넣기 (되돌리기 Ctrl+Z도 됨)
    });
  });

  // 본문은 따로 연결
  el.bodyInput.addEventListener("input", renderBody);
  el.bodySize.addEventListener("input", () => renderFontSize(BODY_FIELD));


  // ── 02 글꼴 ───────────────────────────────────────────────────────────

  // 눈누(projectnoonnu) 글꼴 파일들이 있는 CDN 주소 앞부분
  const NOONNU = "https://cdn.jsdelivr.net/gh/projectnoonnu/";

  // 기본 제공 글꼴 목록
  //   family: CSS에서 쓰는 글꼴 이름 (영문)
  //   name:   선택칸에 보여 줄 이름 (한글)
  //   base:   파일 주소 앞부분
  //   files:  { 굵기: 파일 이름 } → 실제 주소 = base + 파일 이름 + ".woff2"
  // 선택칸 항목과 @font-face가 둘 다 이 목록에서 자동으로 만들어진다.
  // → 새 글꼴을 추가하려면 같은 모양으로 항목을 하나 더 넣기만 하면 된다.
  const FONT_LIBRARY = [
    {
      family: "Pretendard",
      name: "프리텐다드",
      base: NOONNU + "pretendard@1.0/Pretendard-",
      files: { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium",
               600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" },
    },
    {
      family: "Paperozi",
      name: "페이퍼로지",
      base: NOONNU + "2408-3@1.0/Paperlogy-",
      files: { 100: "1Thin", 200: "2ExtraLight", 300: "3Light", 400: "4Regular", 500: "5Medium",
               600: "6SemiBold", 700: "7Bold", 800: "8ExtraBold", 900: "9Black" },
    },
    {
      family: "JeonjuCraftMyungjo",
      name: "전주공예 명조",
      base: NOONNU + "noonfonts_2310@1.0/JeonjuCraftMj",
      files: { 300: "L", 700: "B" },
    },
    {
      family: "MiceMyungjo",
      name: "MICE 명조",
      base: NOONNU + "noonfonts_2206-01@1.0/",
      files: { 400: "MICEMyungjo" },
    },
  ];

  // 파일 확장자 → CSS @font-face의 format() 이름 대응표
  const FONT_FORMATS = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

  // @font-face CSS를 넣어 둘 <style> 태그를 새로 만들어 <head>에 붙인다.
  // 글꼴을 올릴 때마다 이 안의 글자만 바꿔 쓰면 된다.
  const faceStyle = document.createElement("style");
  faceStyle.id = "font-faces";
  document.head.append(faceStyle);

  // 모든 글꼴의 @font-face를 만들어 faceStyle에 넣는다.
  // 기본 글꼴은 굵기마다 하나씩 "전부" 적는다.
  //   ⚠ 고른 굵기 하나만 넣으면 안 된다. 본문의 **굵게**·# 제목은 700을 쓰는데,
  //      700 파일이 없으면 브라우저가 가짜로 굵게 만들어서 모양이 달라진다.
  //   브라우저는 실제로 화면에 쓰이는 굵기의 파일만 내려받으므로 전부 적어도 손해가 없다.
  function renderFontFaces() {
    // 템플릿 문자열(`...`): 여러 줄을 쓸 수 있고, ${값}으로 변수를 끼워 넣을 수 있다
    const face = (family, src, format, weight) => `@font-face {
  font-family: '${family}';
  src: url('${src}') format('${format}');
  font-weight: ${weight};
  font-display: swap;
}`;
    // flatMap: 글꼴마다 [굵기별 @font-face 여러 개]를 만든 뒤, 한 줄짜리 배열로 펼친다
    // Object.entries({300: "L", 700: "B"}) → [["300", "L"], ["700", "B"]]
    // ([weight, file]) 은 배열을 바로 두 변수로 나눠 받는 "구조 분해" 문법
    const lib = FONT_LIBRARY.flatMap((f) =>
      Object.entries(f.files).map(([weight, file]) => face(f.family, `${f.base}${file}.woff2`, "woff2", weight)));
    // 올린 글꼴은 파일 하나에 굵기가 하나뿐이라 400으로만 등록한다.
    // 그래야 **굵게**(700)에서 브라우저가 알아서 굵게 만들어 준다.
    const uploads = state.fontUploads.map((u) => face(u.family, u.src, u.format, 400));
    // ... 은 "펼침 연산자": 두 배열을 하나로 합친다. join("\n")으로 한 덩어리 CSS 글자로.
    faceStyle.textContent = [...lib, ...uploads].join("\n");
  }

  // 선택칸 값을 해석해서 { family, weight }로 돌려준다.
  //   "lib:Pretendard:700" → { family: "Pretendard", weight: 700 }
  //   "up:2"               → 올린 글꼴 2번
  function resolveFont(value) {
    if (value.startsWith("up:")) {
      const u = state.fontUploads[Number(value.slice(3))];   // slice(3): 앞 3글자("up:") 떼기
      if (u) return { family: u.family, weight: 400 };
    }
    // split(":") → ["lib", "Pretendard", "700"]. 첫 칸은 안 쓰므로 비워 두고(,) 나머지만 받는다
    const [, family, weight] = value.split(":");
    return { family, weight: Number(weight) };
  }

  // 글꼴 선택칸(<select>)의 항목을 다시 그린다. 지금 고른 값은 그대로 유지한다.
  //   기본 글꼴: 글꼴별 묶음(<optgroup>) 안에 굵기별 항목 (예: 프리텐다드 700)
  //   올린 글꼴: 맨 아래 "올린 글꼴" 묶음
  function renderFontSelects() {
    const groups = FONT_LIBRARY.map((f) => {
      // Object.keys(f.files) → ["100", "200", ...] 굵기 목록
      const options = Object.keys(f.files)
        .map((w) => `<option value="lib:${f.family}:${w}">${f.name} ${w}</option>`).join("");
      return `<optgroup label="${f.name}">${options}</optgroup>`;
    });
    if (state.fontUploads.length) {
      // 파일 이름은 사용자가 정한 글자라서 escapeHtml로 안전하게
      const options = state.fontUploads
        .map((u, i) => `<option value="up:${i}">${escapeHtml(u.label)}</option>`).join("");
      groups.push(`<optgroup label="올린 글꼴">${options}</optgroup>`);
    }
    // 항목을 새로 그리면 선택이 초기화되므로, 지금 값을 기억했다가 다시 넣는다.
    // 처음 실행 때는 값이 비어 있으므로 INITIAL_FONT를 쓴다.
    const current = el.font.value || INITIAL_FONT;
    el.font.innerHTML = groups.join("");
    el.font.value = current;
  }

  // 고른 글꼴을 결과 이미지에 적용한다.
  //   · 글꼴(family): 결과 이미지 전체(#canvas-inner)에 → 제목·부제목·본문이 물려받는다
  //   · 굵기(weight): 부제목·본문은 고른 굵기 그대로, 제목은 최소 700(굵게)
  function applyFonts() {
    const { family, weight } = resolveFont(el.font.value);
    el.inner.style.fontFamily = `'${family}', serif`;   // 글꼴을 못 받으면 serif(명조 계열)로 대신
    el.titlePreview.style.fontWeight = Math.max(700, weight);
    el.subtitlePreview.style.fontWeight = weight;
    el.bodyPreview.style.fontWeight = weight;
  }

  // 파일을 dataURL("data:font/ttf;base64,AAAB...") 문자열로 읽는다. 실패하면 null.
  // FileReader는 결과를 이벤트(onload)로 알려 주는 옛날 방식이라,
  // Promise로 감싸서 await로 기다릴 수 있게 만들었다.
  const readDataUrl = (file) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);   // 다 읽으면 결과를 돌려줌
    r.onerror = () => resolve(null);      // 실패하면 null
    r.readAsDataURL(file);
  });

  // 글꼴 파일(여러 개 가능)을 읽어서 "올린 글꼴" 목록에 추가한다.
  // async 함수: 안에서 await(기다리기)를 쓸 수 있는 함수
  async function loadFonts(files) {
    // Promise.all: 여러 파일을 하나씩 차례로 기다리지 않고 "동시에" 읽은 뒤, 전부 끝나면 결과 배열을 준다
    const results = await Promise.all(files.map(async (file) => {
      // "My Font.ttf" → "ttf" (마지막 점 뒤). 확장자가 없으면 빈 문자열
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const format = FONT_FORMATS[ext];
      // 지원하지 않는 확장자는 읽지 않고 실패(null) 처리
      const src = format ? await readDataUrl(file) : null;
      return { file, format, src };
    }));

    const added = [];    // 성공한 파일 이름
    const failed = [];   // 실패한 파일 이름
    for (const { file, format, src } of results) {
      if (!src) { failed.push(file.name); continue; }
      const label = file.name.replace(/\.[^.]+$/, "");   // 확장자를 뺀 파일 이름 (선택칸에 표시)
      // 글꼴 안의 실제 이름과 겹치지 않도록 NovelogUpload0, NovelogUpload1 ... 로 따로 이름을 붙인다
      state.fontUploads.push({ label, family: `NovelogUpload${state.fontUploads.length}`, src, format });
      added.push(label);
    }

    // 새 글꼴을 반영: @font-face 다시 만들기 → 선택칸 다시 그리기 → 미리보기에 적용
    renderFontFaces();
    renderFontSelects();
    applyFonts();

    // 드롭존 표시: 전부 실패면 빨간 오류, 하나라도 성공하면 성공 표시
    el.dropFont.classList.toggle("is-error", !added.length);
    el.dropFont.classList.toggle("is-loaded", added.length > 0);
    if (!added.length) {
      el.mainFont.textContent = "글꼴 파일 업로드";
      el.metaFont.textContent = `읽지 못했습니다: ${failed.join(", ")}`;
    } else {
      el.mainFont.textContent = added.join(", ");
      el.metaFont.textContent = `올린 글꼴 ${state.fontUploads.length}개 · 선택칸 맨 아래 "올린 글꼴"에서 고르세요`
        + (failed.length ? ` · 실패: ${failed.join(", ")}` : "");
    }
  }

  // 선택칸에서 다른 글꼴을 고르면("change") 바로 적용
  el.font.addEventListener("change", applyFonts);


  // ── 03 이미지 ─────────────────────────────────────────────────────────

  // 이미지 드롭존을 빨간 오류 상태로 바꾸고 이유를 보여 준다
  function showImageError(file, message) {
    el.dropImg.classList.remove("is-loaded");
    el.dropImg.classList.add("is-error");
    el.mainImg.textContent = file.name;
    el.metaImg.textContent = message;
  }

  // 이미지 파일을 받아서 미리보기 왼쪽 칸에 깐다
  function setImage(file) {
    // file.type 예: "image/png". image/로 시작하지 않으면 이미지가 아님
    if (!file.type.startsWith("image/")) {
      showImageError(file, "이미지 파일이 아닙니다.");
      return;
    }

    // 파일을 가리키는 임시 주소를 만든다 (파일을 업로드하지 않고 브라우저 안에서만 쓰는 주소)
    const url = URL.createObjectURL(file);
    // 보이지 않는 <img>로 먼저 열어 본다(probe = 탐침).
    //   → 진짜 이미지로 열리는지 확인하고, 원래 크기(naturalWidth/Height)도 알아낸다.
    const probe = new Image();
    probe.onload = () => {
      // 예전 이미지 주소는 더 이상 안 쓰므로 메모리에서 풀어 준다
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = url;
      state.imageSize = { w: probe.naturalWidth, h: probe.naturalHeight };

      // 이미지 칸 배경으로 깔고, 칸을 보이게 하고, 관련 버튼·슬라이더를 켠다
      el.imgInner.style.backgroundImage = `url("${url}")`;
      el.imgArea.hidden = false;
      el.imgRemove.disabled = false;
      el.imgReset.disabled = false;
      el.imgWidth.disabled = false;
      setImagePos(50, 50);   // 새 이미지는 가운데부터

      // 드롭존을 성공 상태로
      el.dropImg.classList.remove("is-error");
      el.dropImg.classList.add("is-loaded");
      el.mainImg.textContent = file.name;
      el.metaImg.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} px · 미리보기에서 끌어 위치 조절`;
    };
    probe.onerror = () => {
      // 이미지로 열리지 않음 (깨진 파일 등) → 주소 해제하고 오류 표시
      URL.revokeObjectURL(url);
      showImageError(file, "이미지를 읽지 못했습니다.");
    };
    probe.src = url;   // 주소를 넣는 순간 읽기 시작 → 끝나면 onload 또는 onerror 실행
  }

  // 이미지 제거: setImage와 반대로 전부 처음 상태로 되돌린다
  function removeImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
    state.imageSize = null;

    el.imgInner.style.backgroundImage = "";
    el.imgArea.hidden = true;
    el.imgRemove.disabled = true;
    el.imgReset.disabled = true;
    el.imgWidth.disabled = true;
    setImagePos(50, 50);

    el.dropImg.classList.remove("is-loaded", "is-error");
    el.mainImg.textContent = "이미지 파일";
    el.metaImg.textContent = IMG_META_DEFAULT;
  }

  // 슬라이더 값(%)을 이미지 칸 폭과 옆의 숫자 표시에 반영
  function renderImageWidth() {
    const percent = el.imgWidth.value;
    el.imgWidthValue.textContent = percent + "%";
    el.imgArea.style.width = percent + "%";
  }

  // 이미지 보이는 위치를 정한다 (background-position, 단위 %)
  //   x: 0% = 이미지 왼쪽 끝이 보임, 100% = 오른쪽 끝이 보임
  //   y: 0% = 위쪽 끝이 보임,       100% = 아래쪽 끝이 보임
  function setImagePos(x, y) {
    state.imagePos = { x, y };   // { x: x, y: y } 의 줄임 표기
    el.imgInner.style.backgroundPosition = `${x}% ${y}%`;
  }

  // 드롭존 하나에 "클릭해서 파일 선택"과 "끌어다 놓기"를 함께 연결한다.
  // onFiles에는 항상 파일 "배열"이 넘어간다 (이미지는 첫 번째만, 글꼴은 전부 사용).
  function wireDrop(drop, input, onFiles) {
    // 1) 클릭 → 파일 선택창에서 골랐을 때
    input.addEventListener("change", () => {
      // input.files는 진짜 배열이 아니라서 [...] 로 배열로 바꿔 넘긴다
      if (input.files.length) onFiles([...input.files]);
      // 값을 비워 두어야 같은 파일을 다시 골라도 change가 또 일어난다
      input.value = "";
    });
    // 2) 끌어다 놓기
    //    파일을 끌고 들어오면 강조 표시. preventDefault를 해야 "여기 놓을 수 있음"으로 인정된다.
    ["dragenter", "dragover"].forEach((t) =>
      drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    //    밖으로 나가거나 놓으면 강조 해제
    ["dragleave", "drop"].forEach((t) =>
      drop.addEventListener(t, () => drop.classList.remove("is-over")));
    //    놓았을 때: 브라우저가 파일을 새 탭으로 여는 기본 동작을 막고, 파일을 넘긴다
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
    });
  }

  // 드롭존 연결. 이미지는 첫 번째 파일만(files[0]), 글꼴은 전부(loadFonts에 배열 그대로)
  wireDrop(el.dropImg, el.fileImg, (files) => setImage(files[0]));
  wireDrop(el.dropFont, el.fileFont, loadFonts);
  el.imgRemove.addEventListener("click", removeImage);
  el.imgReset.addEventListener("click", () => setImagePos(50, 50));
  el.imgWidth.addEventListener("input", renderImageWidth);


  // ── 이미지 끌어서 위치 조절 ───────────────────────────────────────────
  // 원리
  //   background-size: cover라서 이미지는 칸보다 가로나 세로 한쪽이 "넘친다".
  //   그 넘치는 길이(overflow)만큼이 움직일 수 있는 범위이고,
  //   background-position 0% ~ 100%가 그 범위의 처음 ~ 끝에 해당한다.
  //   → 마우스를 dx px 움직이면 위치는 (dx ÷ overflow × 100)% 만큼 바뀐다.
  //
  //   단, 미리보기는 축소돼 있다. 화면에서 10px 움직여도 원래 크기 기준으로는
  //   (10 ÷ 배율)px 움직인 것이므로 배율로 나눠서 계산한다.
  //
  // pointer 이벤트: 마우스·터치·펜을 한 가지 코드로 처리할 수 있는 이벤트
  //   pointerdown(누름) → pointermove(움직임) → pointerup(뗌) / pointercancel(취소)

  // 이미지가 칸보다 가로·세로로 얼마나 넘치는지(px) 계산
  function overflowOf() {
    // offsetWidth/Height: transform의 영향을 받지 않는 "원래 크기"
    const boxW = el.imgArea.offsetWidth;
    const boxH = el.imgArea.offsetHeight;
    const { w, h } = state.imageSize;
    // cover 배율 = 가로를 맞추는 배율과 세로를 맞추는 배율 중 큰 쪽 (칸을 꽉 채워야 하니까)
    const fit = Math.max(boxW / w, boxH / h);
    // 확대된 이미지 크기 - 칸 크기 = 넘치는 길이 (한쪽은 0이 된다)
    return { x: w * fit - boxW, y: h * fit - boxH };
  }

  // 누름: 끌기 시작. 시작 위치와 계산에 필요한 값을 state.drag에 기억해 둔다
  el.imgArea.addEventListener("pointerdown", (e) => {
    // 이미지가 없거나, 왼쪽 버튼(0)이 아니면 무시
    if (!state.imageSize || e.button !== 0) return;
    e.preventDefault();
    // 포인터 붙잡기: 끄는 도중 마우스가 칸 밖으로 나가도 계속 이 요소로 이벤트가 온다
    el.imgArea.setPointerCapture(e.pointerId);
    el.imgArea.classList.add("is-dragging");
    state.drag = {
      id: e.pointerId,                             // 어느 손가락/마우스인지 (멀티터치 구분)
      startX: e.clientX,                           // 누른 화면 좌표
      startY: e.clientY,
      startPos: { ...state.imagePos },             // 누른 순간의 이미지 위치 (복사본)
      scale: el.canvas.clientWidth / canvasWidth(), // 미리보기 축소 배율
      overflow: overflowOf(),                      // 넘치는 길이
    };
  });

  // 움직임: 처음 누른 곳에서 얼마나 움직였는지로 새 위치 계산
  el.imgArea.addEventListener("pointermove", (e) => {
    const d = state.drag;
    if (!d || e.pointerId !== d.id) return;   // 끄는 중이 아니거나 다른 포인터면 무시
    // 화면에서 움직인 거리 ÷ 배율 = 원래 크기 기준으로 움직인 거리
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    // 오른쪽으로 끌면 이미지가 오른쪽으로 → 왼쪽 부분이 더 보임 → 위치(%)는 줄어든다 (그래서 빼기)
    // 넘치는 길이가 거의 0인 방향은 움직일 수 없으므로 50%(가운데) 고정
    const x = d.overflow.x > 0.5 ? clamp(d.startPos.x - (dx / d.overflow.x) * 100, 0, 100) : 50;
    const y = d.overflow.y > 0.5 ? clamp(d.startPos.y - (dy / d.overflow.y) * 100, 0, 100) : 50;
    // 소수점 첫째 자리까지만 (×10 → 반올림 → ÷10)
    setImagePos(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  });

  // 뗌 / 취소: 끌기 끝
  const endDrag = (e) => {
    if (!state.drag || e.pointerId !== state.drag.id) return;
    state.drag = null;
    el.imgArea.classList.remove("is-dragging");
  };
  el.imgArea.addEventListener("pointerup", endDrag);
  el.imgArea.addEventListener("pointercancel", endDrag);


  // ── 미리보기 배율 + 비율 레이아웃 ─────────────────────────────────────
  // #canvas-inner를 설정 폭(예: 2000px) 그대로 그린 뒤,
  // (미리보기 칸 폭 ÷ 설정 폭) 배율로 줄여서 보여 준다.
  // transform은 "보이는 모양"만 바꾸고 차지하는 자리는 그대로라서,
  // 바깥 껍데기(#canvas)의 높이를 (원래 높이 × 배율)로 직접 맞춰 준다.
  function renderScale() {
    const w = canvasWidth();
    // clientWidth: 요소의 실제 보이는 폭(px)
    const scale = el.canvas.clientWidth / w;

    // 폭과, 폭에 비례하는 최소 높이·여백·간격 지정
    el.inner.style.width = w + "px";
    el.inner.style.minHeight = Math.round(w * LAYOUT.minHeight) + "px";
    el.textArea.style.padding = Math.round(w * LAYOUT.padding) + "px";
    el.textArea.style.gap = Math.round(w * LAYOUT.gap) + "px";
    el.inner.style.transform = `scale(${scale})`;

    const h = el.inner.offsetHeight;   // transform 전의 원래 높이 = 실제 PNG 높이
    el.canvas.style.height = h * scale + "px";
    el.outSize.textContent = `PNG ${w} × ${h} px`;
  }

  // ResizeObserver: 지켜보는 요소의 크기가 바뀔 때마다 함수를 실행해 준다.
  //   · #canvas 폭이 바뀜  = 창 크기를 바꿈
  //   · #canvas-inner 높이가 바뀜 = 글을 쓰거나 글자 크기·이미지가 바뀜
  // 크기가 실제로 바뀔 때만 불리므로, 입력 이벤트마다 renderScale을 따로 부를 필요가 없다.
  const observer = new ResizeObserver(() => renderScale());
  observer.observe(el.canvas);
  observer.observe(el.inner);
  // 가로 폭 입력은 바로 반영 (가로 폭 자체가 계산의 기준이라)
  el.canvasWidth.addEventListener("input", renderScale);


  // ── PNG 다운로드 ──────────────────────────────────────────────────────
  // html2canvas(요소, 옵션): 요소를 그림(canvas)으로 그려 주는 외부 라이브러리 함수.
  // 화면의 미리보기는 건드리지 않고, html2canvas가 내부에서 만드는 "복사본"(onclone)에서만
  // 축소를 풀어서 원래 크기(설정한 가로 폭)로 찍는다. → 저장할 때 화면이 깜빡이지 않는다.
  async function downloadPng() {
    if (state.busy) return;   // 이미 만드는 중이면 무시 (연타 방지)
    // html2canvas 스크립트를 못 받았으면 (인터넷 문제 등) 안내하고 끝
    if (typeof html2canvas !== "function") {
      setStatus("이미지 변환 도구를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.", true);
      return;
    }

    // 만드는 중 표시: 버튼 끄고 글자 바꾸기
    state.busy = true;
    el.download.disabled = true;
    el.download.textContent = "이미지 만드는 중…";
    setStatus("이미지를 그리는 중입니다.");

    // try { 시도 } catch { 오류가 나면 } finally { 성공하든 실패하든 마지막에 항상 }
    try {
      // 글꼴을 다 받을 때까지 기다린다. 덜 받은 채로 찍으면 기본 글꼴로 나온다.
      await document.fonts.ready;

      const w = canvasWidth();
      const h = el.inner.offsetHeight;
      const shot = await html2canvas(el.inner, {
        scale: 1,               // 지정하지 않으면 화면 배율(레티나 2배 등)만큼 커지므로 1로 고정
        width: w,               // 찍을 크기
        height: h,
        backgroundColor: "#fff",
        logging: false,         // 콘솔에 진행 기록을 찍지 않음
        // 복사본 문서(doc)가 만들어진 직후, 찍기 전에 실행된다. 여기서 축소를 푼다.
        onclone: (doc) => {
          const inner = doc.getElementById("canvas-inner");
          const box = doc.getElementById("canvas");
          inner.style.transform = "none";   // 축소 해제 → 원래 크기
          // 높이를 정수 px로 고정. 줄 높이 때문에 1833.6px처럼 소수가 되면
          // PNG 맨 아래에 1px 흰 줄이 생기기 때문.
          inner.style.height = h + "px";
          box.style.width = w + "px";       // 껍데기도 원래 크기로 (안 그러면 잘림)
          box.style.height = h + "px";
        },
      });

      // canvas → PNG 파일 데이터(Blob).
      // toBlob은 결과를 콜백으로 주는 방식이라 Promise로 감싸 await로 기다린다.
      // (toDataURL보다 메모리를 덜 써서 큰 이미지에 유리)
      const blob = await new Promise((resolve) => shot.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 변환 실패");   // throw: 오류를 일으켜 catch로 보냄
      saveBlob(blob, `${fileNameFromTitle()}.png`);

      setStatus(`PNG를 저장했습니다 · ${shot.width} × ${shot.height} px`);
    } catch (err) {
      console.error(err);   // 개발자 도구(F12) 콘솔에 자세한 오류 출력
      setStatus("이미지를 만들지 못했습니다. 콘솔(F12)을 확인해 주세요.", true);
    } finally {
      // 성공·실패와 상관없이 버튼을 원래대로
      state.busy = false;
      el.download.disabled = false;
      el.download.textContent = "PNG 다운로드";
    }
  }

  el.download.addEventListener("click", downloadPng);


  // ── 처음 열었을 때 한 번 실행 ─────────────────────────────────────────
  // 위에서는 함수를 "만들고" 이벤트를 "연결"만 했다.
  // 여기서 처음 화면 상태를 한 번 그려 준다.
  renderFontFaces();      // 글꼴 @font-face 등록
  renderFontSelects();    // 글꼴 선택칸 채우기
  applyFonts();           // 처음 글꼴 적용
  PLAIN_FIELDS.forEach((field) => { renderPlain(field); renderFontSize(field); });
  renderBody();
  renderFontSize(BODY_FIELD);
  renderImageWidth();
  renderScale();

  // 드롭존 "바깥"에 파일을 떨어뜨리면 브라우저가 그 파일을 열어 버려서
  // 작업 중인 화면이 사라진다. 그걸 막는다.
  // 단, 글자를 끌어다 놓는 건 막지 않도록 "파일을 끌 때만"(types에 "Files"가 있을 때만) 막는다.
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });
})();
