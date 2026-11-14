#!/usr/bin/env node
// 리포 관리자용 검사기. 학습자에게는 필요 없다.
// 검사: 커리큘럼 형식·선수 관계, 국내 근거·글로벌 비교 칸(R10), 근거 키 대장 대조(R11),
// 미리 만든 시각 자료 없음(R5), 설정 JSON 유효성.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const LEVELS = ["Explain", "Apply", "Evaluate", "Develop"];
const FIELDS = ["선수", "핵심 질문", "목표", "만들어 볼 것", "국내 근거", "글로벌 비교"];
const OFFICIAL = ["law.go.kr", "likms.assembly.go.kr", "fsc.go.kr", "fss.or.kr", "ftc.go.kr", "acrc.go.kr", "bai.go.kr", "krx.co.kr",
  "coso.org", "sec.gov", "govinfo.gov", "pcaobus.org", "theiia.org", "iso.org", "fsa.go.jp", "frc.org.uk", "acfe.com", "iaasb.org"];
const KEY = /\[([KW]\d{2})\]/g;
const HEADER = "| 키 | 정식 명칭 | 조문·요지 | 시행·개정 | 변동 | 적용 대상 | URL | 조회일 | 확인 |";
const MARKERS = [[/의무 아님/, "(자율 — 의무 아님)"], [/^(금융회사|공공)/, "(비교 — 일반 기업 적용 아님)"], [/^상장회사/, "(상장회사 대상)"], [/^사업보고서/, "(사업보고서 제출 대상)"], [/^외부감사/, "(외부감사 대상 중 일부 — 적용 제외 있음)"], [/^대규모/, "(대규모 회사 판례)"]];
const GENERAL = /^(주식회사|사업자|누구나)/;
const NO_LAW = "일반 기업 법정 기준 확인 못 함";


function parseCurriculum(text) {
  const modules = new Map();
  const problems = [];
  const keysUsed = [];
  const domesticFields = [];
  const boundaryText = [];
  const blocks = text.split(/^### /m).slice(1);
  for (const block of blocks) {
    const head = block.split("\n")[0];
    const m = head.match(/^([GRCPAX]\d+) · (.+)$/);
    if (!m) { problems.push(`모듈 제목 형식 오류: ${head}`); continue; }
    const id = m[1];
    if (modules.has(id)) problems.push(`${id}: 중복 id`);
    const fields = {};
    for (const line of block.split("\n").slice(1)) {
      const f = line.match(/^- ([^:]+): (.+)$/);
      if (f) fields[f[1]] = f[2];
    }
    const isCapstone = id.startsWith("X");
    for (const name of FIELDS) if (!fields[name] && !(isCapstone && /근거|비교/.test(name))) problems.push(`${id}: 「${name}」 없음`);
    if (!isCapstone) {
      if (fields["국내 근거"] && ![...fields["국내 근거"].matchAll(KEY)].some((k) => k[1].startsWith("K"))) problems.push(`${id}: 국내 근거에 K 키 없음`);
      if (fields["글로벌 비교"] && ![...fields["글로벌 비교"].matchAll(KEY)].some((k) => k[1].startsWith("W"))) problems.push(`${id}: 글로벌 비교에 W 키 없음`);
    }
    if (fields["국내 근거"]) domesticFields.push([id, fields["국내 근거"]]);
    if (fields["경계·연결"]) boundaryText.push(fields["경계·연결"]);
    for (const _ of block.matchAll(/제\d+조(의\d+)?\s*\([^)]*\)\s*([^\n]{80,})/g)) problems.push(`${id}: 조문 원문으로 보이는 긴 인용`);
    keysUsed.push(...[...block.matchAll(KEY)].map((k) => [id, k[1]]));
    if (fields["목표"] && !LEVELS.some((l) => fields["목표"].startsWith(`${l} — `))) problems.push(`${id}: 목표 수준 형식 오류`);
    const prereq = !fields["선수"] || fields["선수"] === "없음" ? [] : fields["선수"].split(",").map((s) => s.trim());
    modules.set(id, prereq);
  }
  for (const [id, prereq] of modules) for (const p of prereq) if (!modules.has(p)) problems.push(`${id}: 없는 선수 ${p}`);
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2 || !modules.has(id)) return;
    if (state.get(id) === 1) { problems.push(`선수 순환: ${[...path, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const p of modules.get(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of modules.keys()) visit(id, []);
  return { modules, problems, keysUsed, domesticFields, boundaryText };
}

function parseSources(text) {
  const rows = new Map();
  const problems = [];
  const headers = text.split("\n").filter((l) => l.startsWith("| 키 |"));
  if (headers.length === 0 || headers.some((h) => h.trim() !== HEADER)) problems.push("대장 머리 행 형식 오류");
  for (const l of text.split("\n").filter((x) => /^\|---/.test(x))) if (l.split("|").length - 2 !== 9) problems.push("대장 구분 행 칸 수 오류");
  for (const line of text.split("\n")) {
    const m = line.match(/^\| ([KW]\d{2}) \|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (rows.has(m[1])) problems.push(`대장 ${m[1]}: 중복 키`);
    rows.set(m[1], cells);
    if (cells.length !== 8) problems.push(`대장 ${m[1]}: 칸 수 ${cells.length}(8이어야 함)`);
    for (const [i, n] of [[0, "정식 명칭"], [1, "조문·요지"], [2, "시행·개정"]]) if (!cells[i]) problems.push(`대장 ${m[1]}: ${n} 없음`);
    if (!/^https:\/\/\S+$/.test(cells[5] || "")) problems.push(`대장 ${m[1]}: URL 칸 형식`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[6] || "") || isNaN(Date.parse(cells[6])) || new Date(cells[6]) > new Date()) problems.push(`대장 ${m[1]}: 조회일 칸 형식`);
    if (!["예", "아니오"].includes(cells[3])) problems.push(`대장 ${m[1]}: 변동 칸은 예/아니오`);
    if (!cells[4]) problems.push(`대장 ${m[1]}: 적용 대상 없음`);
    if (!["본문", "본문(likms)", "검색"].includes(cells[7])) problems.push(`대장 ${m[1]}: 확인 칸 값 오류`);
    if (cells[7] === "검색" && !/^ISO /.test(cells[0])) problems.push(`대장 ${m[1]}: 검색 확인은 ISO 표준만`);
    if (!cells.some((c) => /https?:\/\/\S+/.test(c))) problems.push(`대장 ${m[1]}: URL 없음`);
    if (!cells.some((c) => /^\d{4}-\d{2}-\d{2}$/.test(c))) problems.push(`대장 ${m[1]}: 조회일 없음`);
    if (cells.some((c) => /미확인/.test(c))) problems.push(`대장 ${m[1]}: 미확인 항목은 대장에 두지 않음`);
    for (const u of m[2].matchAll(/https?:\/\/([^/\s)]+)/g)) if (!OFFICIAL.some((d) => u[1] === d || u[1].endsWith(`.${d}`))) problems.push(`대장 ${m[1]}: 공식 도메인 아님 ${u[1]}`);
  }
  return { rows, problems };
}

function findVisualAssets(files) {
  return files.filter((f) => /\.(x?html?|css|svgz?|png|jpe?g|gif|webp|avif|ico|[cm]?jsx?|tsx?)$/i.test(f) && f !== "tools/check.mjs");
}

function findTemplateMarkup(name, text) {
  const hits = [];
  if (/<(!doctype|html|svg|style|canvas|script)\b/i.test(text)) hits.push(name);
  return hits;
}

function main() {
  const { modules, problems, keysUsed, domesticFields, boundaryText } = parseCurriculum(read("curriculum/map.md"));
  const overlap = [...read("docs/build/gates.md").matchAll(/^\| (go-[a-z-]+) \| 있음 \|/gm)].map((m) => m[1]);
  if (overlap.length === 0) errors.push("gates.md 경계 대조 표에서 「있음」 영역을 찾지 못함");
  for (const ws of overlap) if (!boundaryText.some((t) => new RegExp(`${ws}(?![a-z-])`).test(t))) errors.push(`경계 워크스페이스 ${ws}가 「경계·연결」에 없음`);
  errors.push(...problems);
  const src = parseSources(read("curriculum/sources.md"));
  errors.push(...src.problems);
  for (const [id, text] of domesticFields) {
    let general = 0;
    for (const m of text.matchAll(KEY)) {
      const row = src.rows.get(m[1]);
      if (!row) continue;
      if (GENERAL.test(row[4]) && !/의무 아님/.test(row[4])) { general++; continue; }
      const mk = MARKERS.find(([re]) => re.test(row[4]));
      if (!mk) { errors.push(`${id}: ${m[1]} 적용 대상 분류 불가(${row[4]})`); continue; }
      if (!text.slice(m.index + m[0].length).startsWith(mk[1])) errors.push(`${id}: ${m[1]} 바로 뒤에 ${mk[1]} 표시 없음`);
    }
    if (general === 0 && !text.includes(NO_LAW)) errors.push(`${id}: 일반 기업에 적용되는 K 키가 없는데 「${NO_LAW}」 표시 없음`);
  }
  for (const [id, k] of keysUsed) if (!src.rows.has(k)) errors.push(`${id}: 대장에 없는 근거 키 ${k}`);
  for (const k of src.rows.keys()) if (!keysUsed.some(([, u]) => u === k)) errors.push(`대장 ${k}: 커리큘럼에서 쓰지 않음`);
  if (modules.size === 0) errors.push("모듈을 찾지 못함");

  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const f of findVisualAssets(files)) errors.push(`미리 만든 시각 자료 금지: ${f}`);
  for (const f of files.filter((x) => x.endsWith(".md") && !x.startsWith("docs/build/") && existsSync(join(root, x)))) for (const n of findTemplateMarkup(f, read(f))) errors.push(`복사용 마크업 금지: ${n}`);

  for (const p of [".claude/settings.json", "learner-template/state.json"]) {
    try { JSON.parse(read(p)); } catch (e) { errors.push(`${p}: JSON 오류 ${e.constructor.name}`); }
  }
  if (!existsSync(join(root, "learner-template/log.md"))) errors.push("learner-template/log.md 없음");
  for (const s of readdirSync(join(root, ".claude/skills"))) {
    if (statSync(join(root, ".claude/skills", s)).isDirectory() && !existsSync(join(root, ".claude/skills", s, "SKILL.md"))) errors.push(`스킬 ${s}: SKILL.md 없음`);
  }
  const readme = existsSync(join(root, "README.md")) ? read("README.md") : "";
  for (const h of ["**Claude Code**", "**Claude Desktop**"]) if (!readme.includes(h)) errors.push(`README.md에 ${h} 시작법 없음`);
  if (!read(".gitignore").split("\n").includes("learner/")) errors.push(".gitignore에 learner/ 없음");

  if (errors.length) { console.error(errors.map((e) => `FAIL ${e}`).join("\n")); process.exit(1); }
  console.log(`OK 모듈 ${modules.size}개, 근거 ${src.rows.size}건, 파일 ${files.length}개 검사`);
}

main();
