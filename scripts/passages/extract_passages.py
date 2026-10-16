#!/usr/bin/env python3
"""
extract_passages.py — 从统编/PEP 教材 PDF 抽取课文原文（句级）。

与 pipeline.py 的区别：pipeline 生成"教学概要"（跳过原文），本脚本**只要原文**。
复用 pipeline.py 的模型客户端、PDF batch 切分、EXTRACT_MODEL 配置。
配置了 OPENROUTER_API_KEY 时走 OpenRouter，否则走百炼
（DASHSCOPE_API_KEY + DASHSCOPE_API_URL）。

用法:
  python scripts/passages/extract_passages.py --subject chinese \\
      --book 义务教育教科书·语文一年级上册 [--limit-batches 3] [--force]

输出:
  data/passages/{subject}/{bookId}.draft.json
  人工 review 后改名为 {bookId}.json 才会被 collect_texts.py 和前端识别。
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Windows 控制台 GBK 码遇到 emoji 会炸，先重配 stdout
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# pipeline / prompts / subjects 都在 scripts/quiz
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "quiz"))

from pipeline import (  # noqa: E402
    EXTRACT_MODEL,
    LLM_PROVIDER,
    MAX_WORKERS,
    chat_complete,
    pdf_user_content,
    record_usage,
    print_cost_summary,
)
from prompts import PASSAGE_EXTRACT_PROMPT  # noqa: E402
from subjects import (  # noqa: E402
    get_subject_cfg,
    get_grade_semester,
    parse_book_id,
)


OUTPUT_DIR = ROOT / "output"
PASSAGES_DIR = ROOT / "data" / "passages"


# ---------------------------------------------------------------------------
# bookId 生成 — 与 build-data.ts / subjects.parse_book_id 对齐
# ---------------------------------------------------------------------------
def parse_stem(stem: str, subject_id: str) -> tuple[int, str, str] | None:
    """(grade, semester, bookId)。与 build-data.ts / subjects.parse_book_id 一致。"""
    parsed = parse_book_id(stem, subject_id)
    if not parsed:
        return None
    grade, semester, book_id, _edition = parsed
    return grade, semester, book_id


# ---------------------------------------------------------------------------
# speaker 映射 — 与 collect_texts.py pick_profile 保持语义一致
# ---------------------------------------------------------------------------
def pick_speaker(subject_id: str, grade: int, language: str) -> str:
    if language == "English":
        return "sohee" if grade <= 3 else "dylan"
    # Chinese
    if grade <= 4:
        return "vivian"
    return "serena"


# ---------------------------------------------------------------------------
# 模型调用（单 batch）
# ---------------------------------------------------------------------------
def extract_passages_batch(
    batch_path: Path,
    subject_cfg,
    grade_semester: str,
    page_range: str,
    total_pages: int,
    model: str,
    max_retries: int = 3,
) -> list[dict]:
    """对单个 10 页 PDF batch 抽课文。返回 passages 列表（可能为空）。"""
    pdf_b64 = base64.b64encode(batch_path.read_bytes()).decode()
    prompt = PASSAGE_EXTRACT_PROMPT.format(
        subject_name=subject_cfg["display_name"],
        publisher_label=subject_cfg["publisher_label"],
        grade_semester=grade_semester,
        page_range=page_range,
        total_pages=total_pages,
    )

    last_err = ""
    for attempt in range(max_retries):
        try:
            completion = chat_complete(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": pdf_user_content(
                            prompt, pdf_b64, batch_path.name
                        ),
                    }
                ],
                max_tokens=8000,
            )
            record_usage("extract", completion)
            raw = completion.choices[0].message.content.strip()
            # 去除可能的 markdown 代码块包裹
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            data = json.loads(raw)
            return data.get("passages", []) or []
        except json.JSONDecodeError as e:
            last_err = f"JSON 解析失败: {e}; raw 前 200 字: {raw[:200]!r}"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        time.sleep(1 + attempt)

    print(f"  ⚠️  {batch_path.name} 抽取失败: {last_err}", file=sys.stderr)
    return []


# ---------------------------------------------------------------------------
# 合并同名 passage（跨 batch）
# ---------------------------------------------------------------------------
# 只把「刚被 10 页批次切开」的同一篇接回去。
# 页差再大就是下一单元里同名栏目（Listen and chant / Let's talk），不能并。
_CONT_BATCH_GAP = 1
_CONT_PAGE_GAP = 2


def _is_continuation(prev: dict, batch_index: int, page) -> bool:
    if batch_index != prev["_batch"] + _CONT_BATCH_GAP:
        return False
    last = prev.get("_last_page")
    if not isinstance(page, int) or not isinstance(last, int):
        return False
    return 0 <= page - last <= _CONT_PAGE_GAP


def merge_passages(batch_results: list[tuple[int, list[dict]]]) -> list[dict]:
    """合并跨 batch 的同一篇，保留先出现的顺序，去掉完全重复的句子。

    同一本书里每个单元都有 Listen and chant、Let's talk 这类栏目。
    只按 (title, kind) 合并会把后几个单元的句子接到第一篇上，页码停在第一次出现的那一页。
    因此只在「紧挨着的下一个 batch，且页码相差不超过 2 页」时才视为同一篇的续页。

    batch_results: [(batch_index, passages), ...] 已按 batch_index 升序
    """
    records: list[dict] = []

    for batch_index, passages in batch_results:
        for p in passages:
            title = (p.get("title") or "").strip()
            if not title:
                continue
            kind = (p.get("kind") or "prose").strip()
            sentences = [s.strip() for s in (p.get("sentences") or []) if s and s.strip()]
            if not sentences:
                continue
            page = p.get("page_hint")

            prev = next(
                (
                    rec
                    for rec in reversed(records)
                    if rec["title"] == title and rec["kind"] == kind
                ),
                None,
            )
            if prev is not None and _is_continuation(prev, batch_index, page):
                seen = set(prev["sentences"])
                for s in sentences:
                    if s not in seen:
                        prev["sentences"].append(s)
                        seen.add(s)
                if prev.get("author") is None and p.get("author"):
                    prev["author"] = p.get("author")
                if isinstance(page, int):
                    prev["_last_page"] = page
                prev["_batch"] = batch_index
                continue

            records.append(
                {
                    "title": title,
                    "kind": kind,
                    "author": p.get("author"),
                    "page_hint": page,
                    "sentences": list(sentences),
                    "_batch": batch_index,
                    "_last_page": page if isinstance(page, int) else None,
                }
            )

    for rec in records:
        rec.pop("_batch", None)
        rec.pop("_last_page", None)
    return records


# ---------------------------------------------------------------------------
# 单本书主流程
# ---------------------------------------------------------------------------
def process_book(
    subject_id: str,
    book_filename: str,
    limit_batches: int | None,
    force: bool,
    model: str,
) -> None:
    subject_cfg = get_subject_cfg(subject_id)
    stem = Path(book_filename).stem
    if stem.endswith(".pdf"):
        stem = stem[:-4]
    # 支持传入不带 .pdf 的名字
    stem_clean = stem.replace(".pdf", "")

    parsed = parse_stem(stem_clean, subject_id)
    if not parsed:
        sys.exit(f"❌ 无法从文件名解析年级/学期: {stem_clean}")
    grade, _semester, book_id = parsed
    grade_semester = get_grade_semester(stem_clean)

    # 定位 PDF batch 目录
    batch_dir = OUTPUT_DIR / subject_id / "pdfs" / f"{stem_clean}_batches"
    if not batch_dir.exists():
        sys.exit(
            f"❌ 找不到 PDF batch 目录: {batch_dir}\n"
            f"   请先跑 pipeline.py 让它下载并切分 PDF。"
        )

    batches = sorted(
        batch_dir.glob("*.pdf"),
        key=lambda p: int(re.search(r"_p(\d+)-", p.name).group(1)),
    )
    if not batches:
        sys.exit(f"❌ {batch_dir} 里没有 .pdf 文件")

    if limit_batches:
        batches = batches[:limit_batches]

    # 草稿输出路径
    out_dir = PASSAGES_DIR / subject_id
    out_dir.mkdir(parents=True, exist_ok=True)
    draft_path = out_dir / f"{book_id}.draft.json"
    final_path = out_dir / f"{book_id}.json"

    if final_path.exists() and not force:
        print(
            f"⚠️  最终版已存在: {final_path}\n"
            f"   加 --force 才会覆盖（会丢失人工 review 成果）"
        )
        return

    # 估算总页数（从最后一个 batch 的 p{a}-{b} 取 b）
    last_match = re.search(r"_p\d+-(\d+)", batches[-1].name)
    total_pages = int(last_match.group(1)) if last_match else 0

    print(f"📖 {subject_id} / {book_id} / {stem_clean}")
    print(f"   provider: {LLM_PROVIDER}")
    print(f"   model: {model}")
    print(f"   batch 目录: {batch_dir}")
    print(f"   待抽取: {len(batches)} 个 batch / ~{total_pages} 页")
    print(f"   输出: {draft_path}")

    # 并行抽取
    results: dict[int, list[dict]] = {}

    def _do(args):
        i, bp = args
        m = re.search(r"_p(\d+)-(\d+)", bp.name)
        batch_start = int(m.group(1)) if m else 1
        page_range = f"{m.group(1)}-{m.group(2)}" if m else bp.stem
        passages = extract_passages_batch(
            bp, subject_cfg, grade_semester, page_range, total_pages, model
        )
        # page_in_batch → PDF 物理页码（不需要 offset）
        for p in passages:
            pib = p.pop("page_in_batch", None)
            if isinstance(pib, int) and pib >= 1:
                p["page_hint"] = batch_start + pib - 1
            else:
                # fallback: 取 batch 起始页
                p["page_hint"] = batch_start
        return i, passages

    todo = list(enumerate(batches))
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(_do, t) for t in todo]
        done = 0
        for fut in as_completed(futs):
            i, passages = fut.result()
            results[i] = passages
            done += 1
            print(f"   [{done}/{len(todo)}] batch #{i + 1}: {len(passages)} 篇")

    # 按 batch 顺序合并
    ordered = [(i, results[i]) for i in sorted(results.keys())]
    merged = merge_passages(ordered)

    # 组装最终 JSON
    passages_out = []
    for idx, p in enumerate(merged, start=1):
        # 语文 / 英语 的 language 判断：英语学科一定是 English
        language = "English" if subject_id == "english" else "Chinese"
        # 英语对话里混的是英文，古诗/儿歌是中文 —— 都按学科粗粒度归类
        speaker = pick_speaker(subject_id, grade, language)
        passages_out.append(
            {
                "id": f"{book_id}-p{idx}",
                "unitNumber": None,  # 待人工 review 时补
                "lessonNumber": idx,
                "title": p["title"],
                "kind": p["kind"],
                "author": p.get("author"),
                "page_hint": p.get("page_hint"),
                "language": language,
                "speaker": speaker,
                "sentences": p["sentences"],
            }
        )

    doc = {
        "bookId": book_id,
        "subject": subject_id,
        "textbook": stem_clean,
        "grade": grade,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "passages": passages_out,
        "_review_checklist": [
            "1) 对照原 PDF 核对每一句，尤其注意错字 / 漏字 / 拼音",
            "2) 删除非课文内容（练习题、词语表等误抓）",
            "3) 填写 unitNumber（参考 output/{subject}/outlines/...json）",
            "4) 确认无误后重命名 .draft.json → .json",
        ],
    }

    draft_path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n✅ 已写入 {draft_path}")
    print(f"   抽取到 {len(passages_out)} 篇课文")
    print("\n⚠️  记得人工 review 后改名为 .json 才进 TTS 管线")


def main():
    ap = argparse.ArgumentParser(description="从教材 PDF 抽取课文原文")
    ap.add_argument(
        "--subject",
        required=True,
        choices=["chinese", "english"],
        help="学科（只支持语文/英语，数学/科学无课文）",
    )
    ap.add_argument(
        "--book",
        required=True,
        help="教材文件名 stem（不含 .pdf），如 '义务教育教科书·语文一年级上册'",
    )
    ap.add_argument(
        "--limit-batches",
        type=int,
        default=None,
        help="只跑前 N 个 batch（快速冒烟）",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="即使 .json 最终版已存在也覆盖",
    )
    ap.add_argument(
        "--model",
        default=EXTRACT_MODEL,
        help=f"模型 id，默认读取 .env 的 EXTRACT_MODEL（当前 {EXTRACT_MODEL}）",
    )
    args = ap.parse_args()

    process_book(
        args.subject, args.book, args.limit_batches, args.force, args.model
    )
    print_cost_summary()


if __name__ == "__main__":
    main()
