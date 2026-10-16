import { promises as fs } from "fs";
import path from "path";
import { BookOpen } from "@/components/icons";
import { StatsBar } from "@/components/StatsBar";
import { SoundLink } from "@/components/SoundLink";
import { AppShell } from "@/components/layout/AppShell";
import {
  ActiveBookSync,
  ContinueLearningCard,
  CurrentBookBadge,
} from "@/components/ContinueLearningCard";
import type { SiteIndex } from "@/types";
import type { BookOutlineWithLessons } from "./BookPathView";
import BookPathSection from "./BookPathSection";

async function getIndex(): Promise<SiteIndex> {
  const p = path.join(process.cwd(), "public", "data", "index.json");
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function getBookOutline(bookId: string): Promise<BookOutlineWithLessons> {
  const p = path.join(process.cwd(), "public", "data", "books", bookId, "outline.json");
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

export async function generateStaticParams() {
  const index = await getIndex();
  return index.books.map(b => ({ book: b.id }));
}

export default async function BookPage({ params }: { params: Promise<{ book: string }> }) {
  const { book: bookId } = await params;
  const index = await getIndex();
  const book = index.books.find(b => b.id === bookId);
  if (!book) return <div>未找到教材</div>;

  const outline = await getBookOutline(bookId);
  const gradeBooks = index.books.filter(b => b.grade === book.grade);

  return (
    <AppShell centerMaxWidth={720}>
    <main className="min-h-screen bg-bg-soft lg:bg-transparent">
      {/* 访问即成为「当前教材」（首页据此直达本页） */}
      <ActiveBookSync bookId={bookId} grade={book.grade} />

      {/* 移动端顶栏：当前教材徽章（可换书） + stats。
          高度写死 53（py-2 + 徽章 h-9 + 1px 底边），PathMap 的 top-[53px] 与之对齐。 */}
      <div className="lg:hidden h-[53px] bg-white border-b border-bg-softer sticky top-0 z-30">
        <div className="max-w-md mx-auto px-4 py-2 flex items-center justify-between gap-2">
          <CurrentBookBadge book={book} gradeBooks={gradeBooks} />
          <StatsBar compact />
        </div>
      </div>

      {/* 桌面端：当前教材徽章行 */}
      <div className="hidden lg:flex items-center mb-3">
        <CurrentBookBadge book={book} gradeBooks={gradeBooks} />
      </div>

      {/* 续学 CTA —— 有未完成课程会话时出现 */}
      <div className="max-w-md lg:max-w-none mx-auto px-4 lg:px-0 pt-3 lg:pt-0 empty:hidden">
        <ContinueLearningCard />
      </div>

      {/* 移动端：课文听读 + 故事阅读小条 */}
      {(book.hasPassages || book.hasStories) && (
        <div className="lg:hidden max-w-md mx-auto px-4 pt-4 space-y-3">
          {book.hasPassages && (
            <SoundLink
              href={`/reading/${bookId}/`}
              className="flex items-center gap-3 rounded-2xl bg-white border border-bg-softer p-3 hover:border-primary/40 transition-colors"
            >
              <div className="shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-ink">课文听读</div>
                <div className="text-xs text-ink-light mt-0.5">
                  听老师范读 · 自己跟读练习
                </div>
              </div>
              <div className="shrink-0 text-xs text-primary font-bold">去听 →</div>
            </SoundLink>
          )}
          {book.hasStories && (
            <SoundLink
              href={`/stories/${bookId}/`}
              className="flex items-center gap-3 rounded-2xl bg-white border border-bg-softer p-3 hover:border-gold/40 transition-colors"
            >
              <div className="shrink-0 w-10 h-10 rounded-full bg-gold/10 text-gold inline-flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-ink">故事阅读</div>
                <div className="text-xs text-ink-light mt-0.5">
                  趣味故事 · 阅读理解
                </div>
              </div>
              <div className="shrink-0 text-xs text-gold font-bold">去读 →</div>
            </SoundLink>
          )}
        </div>
      )}

      {/* 单元路径 —— 桌面端的课文/故事入口由 PathMap 的 topSlot 承载，随 sticky banner 一起吸附 */}
      <BookPathSection bookId={bookId} outline={outline} book={book} />
    </main>
    </AppShell>
  );
}
