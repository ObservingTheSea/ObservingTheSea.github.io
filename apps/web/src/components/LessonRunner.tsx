"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useAnimation, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import {
  Close,
  Flame,
  BookOpen,
  Target,
  XCircle,
  Lightning,
  Gem,
  Star,
  Sparkle,
  Confetti,
  Rocket,
  Heart,
  CheckCircle,
  Trophy,
} from "@/components/icons";
import type { Lesson, KnowledgeSummary } from "@/types";
import { gradeAnswer } from "@/lib/grade";
import { cn } from "@/lib/cn";
import { MathText } from "@/components/MathText";
import { useProgressStore, MAX_HEARTS, HEART_REFILL_COST, type LessonOutcome } from "@/store/progress";
import {
  XP_PER_CORRECT,
  PERFECT_XP_BONUS,
  FIRST_PERFECT_XP_BONUS,
  THREE_STAR_ACCURACY,
  TWO_STAR_ACCURACY,
  WEEKEND_XP_MULTIPLIER,
  EXAM_XP_MULTIPLIER,
  DAILY_GOAL_BONUS,
  starsFromAccuracy,
  xpForLesson,
  isWeekendXpActive,
} from "@cstf/core/economy";
import { isExamLessonId, EXAM_CONQUER_ACCURACY } from "@/lib/exam";
import type { Quest } from "@cstf/core/quests";
import { playSfx } from "@/lib/sfx";
import { haptic } from "@/lib/haptic";
import { useProgressTicker, formatMsCountdown } from "@/lib/useProgressTicker";
import { rollChestReward, type ChestSlot, type ChestRewardTier } from "@/lib/chestLogic";
import { HeartsBar } from "./HeartsBar";
import { HeartTimer } from "./HeartTimer";
import { QuestionRenderer, type QuestionPhase } from "./question/QuestionRenderer";
import { shouldIgnoreKey, isButtonTarget } from "./question/keyboard";
import { Mascot, type MascotMood, type MascotReaction } from "./Mascot";
import { MuteToggle, AutoNarrateToggle, useSyncMute } from "./MuteToggle";
import { TTSButton } from "./TTSButton";
import { useAutoNarrate } from "@/lib/useAutoNarrate";
import { uiAudio } from "@/lib/uiAudio";
import { playTTS } from "@/lib/tts";
import { ChestModal } from "./ChestModal";
import {
  decideMascotMood,
  decideMascotReaction,
  pickBubble,
  moodToTone,
  type MascotTriggerContext,
} from "@/lib/mascotTriggers";
import { getCosmeticById, type LessonBackdrop } from "@/lib/cosmetics";
import { hasLessonProgress } from "@/lib/lessonSession";
import { ShareCardButton } from "./ShareCardButton";
import { renderBadgeCard, renderStreakCard, buildShareWeek } from "@/lib/shareCard";
import type { QuestionType } from "@cstf/core";

/** 仿 Duolingo 题型胶囊文案（紫色 NEW WORD tag） */
function questionTagLabel(type: QuestionType): string {
  switch (type) {
    case "choice":
      return "选择题";
    case "true_false":
      return "判断题";
    case "fill_blank":
    case "calculation":
      return "计算填空";
    case "fill_blank_text":
      return "文字填空";
    case "word_order":
      return "排序";
    case "matching":
      return "连线配对";
    default:
      return "新题";
  }
}

// 重型/条件渲染的子组件：按需加载以减小 LessonRunner 初始 chunk
const FeedbackPanel = dynamic(
  () => import("./FeedbackPanel").then(m => ({ default: m.FeedbackPanel })),
  { ssr: false },
);
const ConfettiCanvas = dynamic(
  () => import("./ConfettiCanvas").then(m => ({ default: m.ConfettiCanvas })),
  { ssr: false },
);
const Modal = dynamic(
  () => import("./Modal").then(m => ({ default: m.Modal })),
  { ssr: false },
);
const SpeechBubble = dynamic(
  () => import("./SpeechBubble").then(m => ({ default: m.SpeechBubble })),
  { ssr: false },
);
const ComboOverlay = dynamic(
  () => import("./ComboOverlay").then(m => ({ default: m.ComboOverlay })),
  { ssr: false },
);

/** 齿轮小图标（仅课程顶栏移动端设置入口用，避免动 icons.tsx） */
function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * 顶栏下方一条小提示：「再答对 N 题就能拿到 三/二 星」
 *
 * 计算逻辑：假设剩余题全对，最终准确率是 (correctCount + remaining) / total。
 * 反推"还差几道连续答对就能跨过 0.95 / 0.75 阈值"。
 *
 * 首答口径：answered = 已首答过的题数（错题重排的复答不影响）。
 */
function StarDistanceHint({
  correctCount,
  answered,
  total,
}: {
  correctCount: number;
  answered: number;
  total: number;
}) {
  const remaining = total - answered;
  if (remaining <= 0 || total === 0) return null;

  // 当前所需答对数（达到三星 / 二星 的阈值 —— @cstf/core 单一事实源）
  const need3 = Math.ceil(THREE_STAR_ACCURACY * total);
  const need2 = Math.ceil(TWO_STAR_ACCURACY * total);

  // 还差多少道才能拿到对应星
  const missingFor3 = Math.max(0, need3 - correctCount);
  const missingFor2 = Math.max(0, need2 - correctCount);

  // 选优先级最高的提示：三星仍然可达？否则二星？否则不显示
  let label: string | null = null;
  let starsToShow = 0;
  let highlight = false;
  if (missingFor3 <= remaining) {
    label = `还差 ${missingFor3} 题就 三星`;
    starsToShow = 3;
    if (missingFor3 <= 1) highlight = true;
  } else if (missingFor2 <= remaining) {
    label = `还差 ${missingFor2} 题就 二星`;
    starsToShow = 2;
    if (missingFor2 <= 1) highlight = true;
  }

  if (!label) return null;

  return (
    <div className="max-w-md lg:max-w-2xl mx-auto w-full px-5 pt-2">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={
          highlight
            ? { opacity: 1, y: 0, scale: [1, 1.04, 1] }
            : { opacity: 1, y: 0, scale: 1 }
        }
        transition={
          highlight
            ? { scale: { duration: 1.6, repeat: Infinity, ease: "easeInOut" } }
            : { duration: 0.3 }
        }
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-extrabold border-2",
          highlight
            ? "border-warning bg-warning/15 text-warning"
            : "border-bg-softer bg-white text-ink-light",
        )}
      >
        <span className="inline-flex items-center gap-0.5 text-gold">
          {Array.from({ length: starsToShow }).map((_, i) => (
            <Star key={i} className="w-3 h-3 fill-current" />
          ))}
        </span>
        <span>{label}</span>
      </motion.div>
    </div>
  );
}

interface LessonRunnerProps {
  lesson: Lesson;
  /** 本节课紧跟的宝箱 slot（由 page.tsx 预计算） */
  chestSlot?: ChestSlot | null;
}

/** 结算页的任务进度快照：before = 通关记账前，after = 记账后 */
interface QuestSnapshot {
  quest: Quest;
  before: number;
  after: number;
}

/**
 * 一次性通关成果快照。传给 CompletionScreen 展示，
 * 避免 CompletionScreen 直接访问中间态。
 */
interface SessionStats {
  /** 通关记账原子结算单（recordLessonComplete 返回值） */
  outcome: LessonOutcome;
  accuracy: number;
  perfect: boolean;
  /** 本节是否享受周末双倍 XP */
  weekend: boolean;
  /** ⚔️ 是否单元挑战课（XP ×2，宝石 drip 不翻倍） */
  isExam: boolean;
  /** 单元征服：挑战课 accuracy ≥ 0.8 */
  conquered: boolean;
  maxCombo: number;
  durationSec: number;
  chestReward: { slot: ChestSlot; gems: number; tier: ChestRewardTier } | null;
  /** 今天三条任务的 before/after 进度（任务进度幕用） */
  quests: QuestSnapshot[];
}

export function LessonRunner({ lesson, chestSlot = null }: LessonRunnerProps) {
  useSyncMute();
  useProgressTicker(); // 红心实时恢复
  const router = useRouter();
  const recordComplete = useProgressStore(s => s.recordLessonComplete);
  const addMistake = useProgressStore(s => s.addMistake);
  const loseHeart = useProgressStore(s => s.loseHeart);
  const upsertLessonSession = useProgressStore(s => s.upsertLessonSession);
  const clearLessonSession = useProgressStore(s => s.clearLessonSession);
  const addGems = useProgressStore(s => s.addGems);
  const claimChest = useProgressStore(s => s.claimChest);
  const buyHeartRefill = useProgressStore(s => s.buyHeartRefill);
  const addLearningTimeMs = useProgressStore(s => s.addLearningTimeMs);
  const chestAlreadyClaimed = useProgressStore(
    s => !!(chestSlot && s.claimedChests[chestSlot.id]),
  );
  const hearts = useProgressStore(s => s.hearts);
  const gems = useProgressStore(s => s.gems);
  const backdropId = useProgressStore(s => s.equippedBackdrop);
  // 默认「干净简洁」不写死浅色，交给 .lesson-canvas 在暗色下换成 night 底。
  // 浅色装饰背景同样不进暗色（否则浅色字会糊在浅色渐变上）；星空/极光这类
  // 深色场景（needsOverlay）暗色下继续用。
  const backdropStyle = useMemo<React.CSSProperties>(() => {
    const item = getCosmeticById(backdropId) as LessonBackdrop | undefined;
    if (!item || item.type !== "lesson_backdrop" || item.id === "backdrop_default") {
      return {};
    }
    const vars: Record<string, string> = { "--lesson-bg": item.data.background };
    if (item.data.needsOverlay) {
      vars["--lesson-bg-dark"] = item.data.background;
    }
    return vars as React.CSSProperties;
  }, [backdropId]);
  const prefersReduced = useReducedMotion();

  // 周末双倍 XP（本地时间周六/周日）—— 所见即所得：预览/飘字/结算全部按 ×2 显示
  const [weekend] = useState(() => isWeekendXpActive());
  // ⚔️ 单元挑战课：XP 总额 ×2（与周末可叠加 = ×4），宝石 drip 不翻倍
  const isExam = isExamLessonId(lesson.id);
  const xpMultiplier =
    (isExam ? EXAM_XP_MULTIPLIER : 1) * (weekend ? WEEKEND_XP_MULTIPLIER : 1);
  const xpPerCorrectShown = XP_PER_CORRECT * xpMultiplier;

  const questions = useMemo(() => lesson.questions, [lesson]);
  const total = questions.length;
  const questionById = useMemo(
    () => new Map(questions.map(q => [q.id, q])),
    [questions],
  );

  // 等待从 zustand persist 恢复已保存的会话后再渲染，避免闪烁
  const [ready, setReady] = useState(false);
  // === 错题重排队列（REQUEUE，parity-14）===
  // currentId = 正在作答的题；queue = 之后待答的题（答错的会被 push 回队尾）
  const [currentId, setCurrentId] = useState<number | null>(
    () => questions[0]?.id ?? null,
  );
  const [queue, setQueue] = useState<number[]>(() => questions.slice(1).map(q => q.id));
  /** 已答对（离场）的题目 id，进度条口径 */
  const [solved, setSolved] = useState<number[]>([]);
  /** 已首答过的题目 id 集合（accuracy 首答口径；复答不重复计） */
  const attemptedRef = useRef<Set<number>>(new Set());
  /** 每次换题 +1，驱动题卡进出场动画（同一题重排回来也要重新入场） */
  const [serveKey, setServeKey] = useState(0);

  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<QuestionPhase>("answering");
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  /** 首答答对数（星级/XP 口径） */
  const [correctCount, setCorrectCount] = useState(0);
  /** 首答答错数（= missed 集合大小） */
  const [mistakeCount, setMistakeCount] = useState(0);
  const [done, setDone] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  // 失败页仅在「用户主动退出且 0 心」时出现；0 心进入时在恢复逻辑里决定弹 Gate 还是失败页
  const [failed, setFailed] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  /** session 内累计 XP（首答口径，展示 + 持久化） */
  const [sessionXp, setSessionXp] = useState(0);
  // +XP 飘字动画队列
  const [xpFloats, setXpFloats] = useState<
    { id: number; startX: number; startY: number; endX: number; endY: number }[]
  >([]);
  const xpFloatIdRef = useRef(0);
  const xpTargetRef = useRef<HTMLDivElement>(null);
  const [mascotReact, setMascotReact] = useState<MascotReaction>(null);
  const [mascotReactKey, setMascotReactKey] = useState(0);
  /** Mascot 当前的"持续表情"，由 mascotTriggers 上下文决定 */
  const [mascotMood, setMascotMood] = useState<MascotMood>("happy");
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [bubbleTone, setBubbleTone] = useState<"neutral" | "primary" | "danger">("neutral");
  const [bubbleKey, setBubbleKey] = useState(0);
  const [comboOverlay, setComboOverlay] = useState<{ combo: number; key: number } | null>(null);
  // 标记是否曾经出现过连击/弹层 —— 仅在首次需要时才 mount，触发 dynamic chunk 按需加载
  const [comboMounted, setComboMounted] = useState(false);
  const [exitConfirmMounted, setExitConfirmMounted] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // 断心遮罩（web-lesson-5）：0 心时点「继续」才弹，期间不清除会话
  const [gateMounted, setGateMounted] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  // 移动端设置小弹层（web-lesson-9）
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showIntro, setShowIntro] = useState(lesson.knowledge !== null);
  /**
   * 🔒 交互闸门（webrunner-5）：任何遮罩打开时，题目区的键盘快捷键 / 点击 /
   * 配对题自动提交都必须停摆 —— 否则用户在断心遮罩前敲数字键就能把题判掉。
   */
  const locked = showExitConfirm || gateOpen || showSettings || showIntro;

  const shakeControls = useAnimation();
  const progressControls = useAnimation();

  const startTimeRef = useRef<number>(Date.now());
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 会话恢复：挂载时若存在同课程的持久化进度，恢复队列/连击/XP（web-lesson-12）
  useEffect(() => {
    // 先结算离线期间的自然回心，再判断 0 心入口
    useProgressStore.getState().refreshHearts();
    const stored = useProgressStore.getState().activeLesson;
    let sessionRestored = false;
    // 可续会话口径统一（webrunner-7）：同一课程 + 有过实际作答。
    // 一题未答的空会话不算进度 —— 否则课前知识讲解会被永久跳过。
    if (stored && stored.lessonId === lesson.id && hasLessonProgress(stored)) {
      const validIds = new Set(questions.map(q => q.id));
      let restoredSolved: number[];
      let restoredQueue: number[];
      if (stored.queueIds && stored.solvedIds) {
        restoredSolved = stored.solvedIds.filter(id => validIds.has(id));
        const seen = new Set(restoredSolved);
        restoredQueue = stored.queueIds.filter(id => validIds.has(id) && !seen.has(id));
        // 课程数据更新后可能出现新题：补进队尾
        const known = new Set([...restoredSolved, ...restoredQueue]);
        for (const q of questions) if (!known.has(q.id)) restoredQueue.push(q.id);
      } else {
        // 老版本会话（线性 index）：前 index 题视为已过，其余按原序排队
        const safeIndex = Math.min(stored.index, Math.max(0, total - 1));
        restoredSolved = questions.slice(0, safeIndex).map(q => q.id);
        restoredQueue = questions.slice(safeIndex).map(q => q.id);
      }
      if (restoredQueue.length === 0) {
        // 异常兜底：队列已空却没结算 → 丢弃会话重新开始
        useProgressStore.getState().clearLessonSession();
      } else {
        setCurrentId(restoredQueue[0]);
        setQueue(restoredQueue.slice(1));
        setSolved(restoredSolved);
        setCorrectCount(stored.correctCount);
        setMistakeCount(stored.mistakeCount);
        setCombo(stored.combo);
        setMaxCombo(stored.maxCombo ?? stored.combo);
        setSessionXp(stored.sessionXp ?? stored.correctCount * XP_PER_CORRECT);
        // attempted 还原。队列不变式：[未答过的原序前缀 …… 重排的错题后缀]
        const freshRemaining = Math.max(
          0,
          total - (stored.correctCount + stored.mistakeCount),
        );
        const requeued = restoredQueue.slice(
          Math.min(freshRemaining, restoredQueue.length),
        );
        attemptedRef.current = new Set([...restoredSolved, ...requeued]);
        startTimeRef.current = stored.startedAt || Date.now();
        // 有进度时默认跳过知识点介绍（用户已经看过了）
        setShowIntro(false);
        sessionRestored = true;
      }
    } else if (stored) {
      // 切换到了新课程 / 旧版本留下的空会话 → 丢弃
      useProgressStore.getState().clearLessonSession();
    }
    // 0 心进入：有可续会话 → 弹断心遮罩（可补心续课 / 去复习回心）；
    // 全新开课 → 失败页（附回心倒计时）
    if (useProgressStore.getState().hearts <= 0) {
      if (sessionRestored) {
        setGateMounted(true);
        setGateOpen(true);
      } else {
        setFailed(true);
      }
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  // 持久化会话：只要还在答题，就把核心进度写回 store
  useEffect(() => {
    if (!ready || done || failed) return;
    // 课前知识讲解还没看完 → 一节课都还没开始，不落盘（webrunner-4）
    if (showIntro) return;
    // 一题都还没作答 → 不落盘。否则首页会出现假的「继续学习」卡，
    // 而且下次进入这节课会因为「有进度」跳过课前知识讲解。
    if (attemptedRef.current.size === 0 && solved.length === 0) return;
    // answering 相位：当前题还没答，排在持久化队列最前
    const persistedQueue =
      phase === "answering" && currentId != null ? [currentId, ...queue] : queue;
    // 最后一题判定后（checked，队列已空）不要写空会话（webrunner-3）：
    // 用户此时若直接离开，空队列快照会在恢复时命中「队列空却没结算」兜底 →
    // 整节课进度被清零。保留上一次非空快照，与 iOS 的 guard 对齐。
    if (persistedQueue.length === 0) return;
    upsertLessonSession({
      lessonId: lesson.id,
      index: solved.length,
      correctCount,
      mistakeCount,
      combo,
      startedAt: startTimeRef.current,
      queueIds: persistedQueue,
      solvedIds: solved,
      maxCombo,
      sessionXp,
    });
  }, [
    ready,
    done,
    failed,
    showIntro,
    lesson.id,
    phase,
    currentId,
    queue,
    solved,
    correctCount,
    mistakeCount,
    combo,
    maxCombo,
    sessionXp,
    upsertLessonSession,
  ]);

  // 通关时清除持久化会话。
  // ⚠️ failed 不清档（webrunner-1）：失败页也提供「再来一次」，而断心遮罩的
  // 「退出」承诺过「回来接着上次继续」—— 清档会直接毁掉整节课进度。
  useEffect(() => {
    if (done) {
      clearLessonSession();
    }
  }, [done, clearLessonSession]);

  // 💗 红心自然恢复后自动收起断心遮罩（webrunner-2）：
  // 遮罩是 dismissible={false} 的，没有这条 effect 用户会被锁死在弹层里。
  useEffect(() => {
    if (!gateOpen || hearts <= 0) return;
    setGateOpen(false);
    // 与「补心续课」同一分支：反馈看完了就端上下一题，答题中则原地接着答
    if (phase === "checked") serveNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateOpen, hearts, phase]);

  // ⏱️ 学习时长：课中每 30s 冲一次账。
  // 只计「页面可见」的时间（webrunner-6）：切后台先把可见的那段冲掉再停表，
  // 回到前台重新起表。挂机放着不管不会计入当日时长，也就不会误触发家长上限。
  useEffect(() => {
    if (!ready || done || failed) return;
    let lastFlush = Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;

    /** 结算「上次结算点 → 现在」这段；spanWasVisible=false 时只推进游标不记账 */
    const flush = (spanWasVisible: boolean) => {
      const now = Date.now();
      const delta = now - lastFlush;
      lastFlush = now;
      if (!spanWasVisible) return;
      // 单次冲账封顶 10 分钟：极端情况下（系统休眠等）也不把当日时长打爆
      if (delta > 500) addLearningTimeMs(Math.min(delta, 10 * 60_000));
    };
    const startTimer = () => {
      if (interval == null) {
        interval = setInterval(() => flush(document.visibilityState === "visible"), 30_000);
      }
    };
    const stopTimer = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // 这段（前台 → 现在）确实是可见时间，先记账再停表
        flush(true);
        stopTimer();
      } else {
        lastFlush = Date.now();
        startTimer();
      }
    };
    if (document.visibilityState === "visible") startTimer();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      flush(document.visibilityState === "visible");
    };
  }, [ready, done, failed, addLearningTimeMs]);

  const current = currentId != null ? questionById.get(currentId) : undefined;
  const answeredFirst = correctCount + mistakeCount;
  const progress =
    total > 0 ? (Math.min(solved.length, total) / total) * 100 : 0;

  // 进度条宽度动画（只在答对时前进：solved 才计入）
  useEffect(() => {
    progressControls.start({
      width: `${progress}%`,
      transition: { duration: 0.4, ease: "easeOut" },
    });
  }, [progress, progressControls]);

  function triggerReact(kind: MascotReaction) {
    setMascotReact(kind);
    setMascotReactKey(k => k + 1);
  }

  function showBubble(text: string, tone: "neutral" | "primary" | "danger" = "neutral", duration = 1800) {
    setBubbleText(text);
    setBubbleTone(tone);
    setBubbleKey(k => k + 1);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setBubbleText(null), duration);
  }

  function showComboOverlay(c: number) {
    setComboMounted(true);
    setComboOverlay({ combo: c, key: Date.now() });
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    comboTimerRef.current = setTimeout(() => setComboOverlay(null), 1400);
    // 播放连击里程碑语音
    const comboLabel = c === 3 ? "连击 三连!" : c === 5 ? "连击 五连!" : c === 10 ? "连击 十连!" : null;
    if (comboLabel) void playTTS(uiAudio(comboLabel));
  }

  // 卸载时清计时器
  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    };
  }, []);

  /**
   * 答错 / 跳过共用的"判错"流程：
   * 进入 checked 相位 → 错题 push 回队尾 → 清连击、（首答）记错题、扣心
   * → 触感音效 + 抖动 + 气泡 + 心碎音。0 心不立即失败：点继续时弹 Gate。
   */
  function applyWrongAnswer(firstAttempt: boolean) {
    if (!current) return;
    setIsCorrect(false);
    setPhase("checked");

    // ♻️ 错题重排：答错的题回到队尾，全部做对才能结算（parity-14）
    setQueue(q => [...q, current.id]);

    // === 上下文感知的 mascot mood/reaction 决策 ===
    const triggerCtx: MascotTriggerContext = {
      isCorrect: false,
      isPerfectSession: false,
      attemptCount: firstAttempt ? 1 : 2,
      remainingHearts: Math.max(0, hearts - 1),
      combo: 0,
      maxCombo,
      index: answeredFirst,
      total,
      totalCorrectInSession: correctCount,
    };
    const nextMood = decideMascotMood(triggerCtx);
    const nextReaction = decideMascotReaction(triggerCtx);
    setMascotMood(nextMood);

    setCombo(0);
    if (firstAttempt) {
      setMistakeCount(m => m + 1);
      addMistake(lesson.id, lesson.title, current);
    }

    // ★ T+0ms ★ 重触觉 + 错音
    haptic("heavy");
    playSfx("wrong");

    // ★ T+35ms ★ Mascot 反应（错峰）
    setTimeout(() => triggerReact(nextReaction), 35);

    // ★ T+50ms ★ 题区抖动
    if (!prefersReduced) {
      setTimeout(() => {
        shakeControls.start({
          x: [0, -8, 8, -5, 5, 0],
          transition: { duration: 0.45 },
        });
      }, 50);
    }

    // ★ T+50ms ★ 气泡按 mood
    setTimeout(
      () => showBubble(pickBubble(nextMood), moodToTone(nextMood), 1800),
      50,
    );

    // ★ T+120ms ★ 心碎音效（错峰避免和 wrong 重叠）
    setTimeout(() => playSfx("heartLoss"), 120);

    loseHeart();
  }

  /** 跳过本题：不判分，直接按答错处理（与多邻国 SKIP 语义一致） */
  function skipQuestion() {
    if (locked) return;
    if (!current || phase !== "answering") return;
    const firstAttempt = !attemptedRef.current.has(current.id);
    attemptedRef.current.add(current.id);
    // 清掉已选答案，反馈阶段只高亮正确答案
    setAnswer("");
    applyWrongAnswer(firstAttempt);
  }

  function handleCheck() {
    if (locked) return;
    if (!current || phase !== "answering") return;
    if (!answer.trim()) return;
    const firstAttempt = !attemptedRef.current.has(current.id);
    attemptedRef.current.add(current.id);
    const ok = gradeAnswer(current, answer);
    if (!ok) {
      applyWrongAnswer(firstAttempt);
      return;
    }
    setIsCorrect(true);
    setPhase("checked");

    // ✅ 答对：立刻离场（solved 计入进度条）
    setSolved(s => [...s, current.id]);

    // === 上下文感知的 mascot mood/reaction 决策 ===
    const newCombo = combo + 1;
    const triggerCtx: MascotTriggerContext = {
      isCorrect: true,
      isPerfectSession: mistakeCount === 0,
      attemptCount: firstAttempt ? 1 : 2,
      remainingHearts: hearts,
      combo: newCombo,
      maxCombo: Math.max(maxCombo, newCombo),
      index: answeredFirst,
      total,
      totalCorrectInSession: correctCount + (firstAttempt ? 1 : 0),
    };
    const nextMood = decideMascotMood(triggerCtx);
    const nextReaction = decideMascotReaction(triggerCtx);
    setMascotMood(nextMood);

    // XP / 星级按首答口径：错题重排后的复答不再加 XP（与结算入账值对齐）
    if (firstAttempt) {
      setCorrectCount(c => c + 1);
      setSessionXp(xp => xp + XP_PER_CORRECT);
    }
    setCombo(newCombo);
    setMaxCombo(mc => (newCombo > mc ? newCombo : mc));

    // ★ T+0ms ★ 触觉立即响应
    haptic("light");
    // ★ T+0ms ★ 音效（Web Audio 几乎零延迟）
    playSfx("correct");

    // +XP 飘字：从屏幕中间飞到顶栏 XP 徽章（仅首答有 XP）
    if (firstAttempt && typeof window !== "undefined" && xpTargetRef.current) {
      const rect = xpTargetRef.current.getBoundingClientRect();
      const endX = rect.left + rect.width / 2;
      const endY = rect.top + rect.height / 2;
      const startX = window.innerWidth / 2;
      const startY = window.innerHeight * 0.45;
      const id = ++xpFloatIdRef.current;
      setXpFloats(list => [...list, { id, startX, startY, endX, endY }]);
    }

    // ★ T+35ms ★ Mascot 反应（错峰，让用户先听到声音再看到动作）
    setTimeout(() => triggerReact(nextReaction), 35);

    // ★ T+200ms ★ 进度条脉冲：combo 越高，幅度越大（递增刺激）
    if (!prefersReduced) {
      const pulseAmp = Math.min(1.6 + newCombo * 0.05, 2.1);
      setTimeout(() => {
        progressControls.start({
          scaleY: [1, pulseAmp, 1],
          transition: { duration: 0.35 },
        });
      }, 200);
    }

    // ★ T+50ms ★ 气泡：按 mood 选择文案
    setTimeout(
      () => showBubble(pickBubble(nextMood), moodToTone(nextMood), 1400),
      50,
    );

    // ★ T+320ms ★ Combo 里程碑
    if (newCombo === 3 || newCombo === 5 || newCombo === 10) {
      setTimeout(() => {
        playSfx("combo");
        showComboOverlay(newCombo);
      }, 320);
    }
  }

  /** 上一题收尾后端上下一题（错题已在判错时回到队尾） */
  function serveNext() {
    const [next, ...rest] = queue;
    setCurrentId(next ?? null);
    setQueue(rest);
    setServeKey(k => k + 1);
    setAnswer("");
    setIsCorrect(null);
    setPhase("answering");
    setMascotMood("happy");
  }

  /** 通关结算：原子记账 + 任务进度快照 + 冻结展示数据 */
  function finishLesson() {
    const accuracy = total > 0 ? correctCount / total : 0;
    const perfect = mistakeCount === 0;
    const store = useProgressStore.getState();

    // 首次三星（该课历史首次达 3 星）额外奖励 —— 写入前只读快照判断，
    // 真正的 perfectedLessons 标记由 recordLessonComplete 内部完成
    const alreadyPerfected = !!store.perfectedLessons[lesson.id];
    const firstPerfect = starsFromAccuracy(accuracy) === 3 && !alreadyPerfected;
    // XP 公式单一事实源：@cstf/core xpForLesson（挑战 ×2 → 周末再 ×2，可叠加）
    const xp = xpForLesson({
      correctCount,
      perfect,
      firstPerfect,
      isWeekend: weekend,
      isExam,
    });

    // 通关宝箱命中：有 chestSlot 且尚未领取
    const chestReward =
      chestSlot && !chestAlreadyClaimed
        ? { slot: chestSlot, ...rollChestReward() }
        : null;

    // 🗓️ 任务进度快照（记账前），任务进度幕用 before → after 做推进动画
    const questsToday = store.todayQuests();
    const before = questsToday.map(q => store.questProgress(q.kind));

    // 写入 store（记录 + 宝箱领取；首次完美的标记在 recordComplete 内部）
    if (chestReward) {
      claimChest(chestReward.slot.id);
      addGems(chestReward.gems);
    }
    const outcome = recordComplete(lesson.id, lesson.title, accuracy, xp);
    const after = useProgressStore.getState();
    const quests: QuestSnapshot[] = questsToday.map((q, i) => ({
      quest: q,
      before: before[i],
      after: after.questProgress(q.kind),
    }));

    // 冻结一份展示快照供 CompletionScreen 用
    setSessionStats({
      outcome,
      accuracy,
      perfect,
      weekend,
      isExam,
      conquered: isExam && accuracy >= EXAM_CONQUER_ACCURACY,
      maxCombo,
      durationSec: Math.round((Date.now() - startTimeRef.current) / 1000),
      chestReward,
      quests,
    });
    setDone(true);
  }

  function handleContinue() {
    if (locked) return;
    if (failed || done || phase !== "checked") return;
    if (isCorrect) {
      if (queue.length === 0) {
        finishLesson();
        return;
      }
      serveNext();
      return;
    }
    // 答错致 0 心：反馈面板看完、点继续时才弹断心遮罩（web-lesson-5）
    if (hearts <= 0) {
      setGateMounted(true);
      setGateOpen(true);
      return;
    }
    serveNext();
  }

  // 配对题（web-lesson-11）：全部配完自动提交 canonical answer
  useEffect(() => {
    if (locked) return; // 遮罩打开时不许自动判分（webrunner-5）
    if (phase !== "answering" || !current || current.type !== "matching") return;
    if (!answer.trim()) return;
    if (gradeAnswer(current, answer)) handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, phase, currentId, locked]);

  // ⌨️ 键盘快捷键（web-lesson-3）：Enter 提交 / 继续，空格 继续。
  // 数字选选项在各题目组件内实现（1-4 选项、1/2 判断、1-8 配对、数字键盘）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e)) return;
      if (!ready || done || failed) return;
      if (locked) return;
      if (phase === "answering") {
        if (e.key === "Enter") {
          if (isButtonTarget(e)) return; // 焦点在按钮上交给原生 click
          if (answer.trim()) {
            e.preventDefault();
            handleCheck();
          }
        }
        return;
      }
      // checked 相位：Enter / 空格 继续
      if (e.key === "Enter" || e.key === " ") {
        if (isButtonTarget(e)) return;
        e.preventDefault();
        handleContinue();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /**
   * 失败后"重新开始"：本组件是纯客户端渲染，router.refresh() 不会重置
   * client state，必须手动把整个会话 state 归零后从第一题重来。
   */
  function resetSession() {
    clearLessonSession();
    setCurrentId(questions[0]?.id ?? null);
    setQueue(questions.slice(1).map(q => q.id));
    setSolved([]);
    attemptedRef.current = new Set();
    setServeKey(k => k + 1);
    setAnswer("");
    setPhase("answering");
    setIsCorrect(null);
    setCorrectCount(0);
    setMistakeCount(0);
    setDone(false);
    setSessionStats(null);
    setFailed(false);
    setCombo(0);
    setMaxCombo(0);
    setSessionXp(0);
    setXpFloats([]);
    setMascotMood("happy");
    setBubbleText(null);
    setComboOverlay(null);
    setGateOpen(false);
    startTimeRef.current = Date.now();
  }

  function handleRequestExit() {
    playSfx("tap");
    haptic("light");
    // 零进度（一题都没答过）直接退出，不弹确认（web-lesson-16）
    if (attemptedRef.current.size === 0 && solved.length === 0) {
      clearLessonSession();
      router.push(`/book/${lesson.bookId}/`);
      return;
    }
    setExitConfirmMounted(true);
    setShowExitConfirm(true);
  }

  function handleConfirmExit() {
    // 用户主动确认退出 → 放弃本次进度
    playSfx("tap");
    haptic("medium");
    clearLessonSession();
    router.push(`/book/${lesson.bookId}/`);
  }

  // ===== 断心遮罩的三个出口 =====
  function handleGateRefill() {
    const ok = buyHeartRefill();
    if (!ok) {
      playSfx("wrong", { volume: 0.35 });
      haptic("medium");
      return;
    }
    playSfx("unlock");
    haptic("success");
    setGateOpen(false);
    // 原地续课：判错时错题已回到队尾 → 端上下一题；
    // 0 心恢复入口（answering 相位）直接关遮罩接着答当前题
    if (phase === "checked") serveNext();
  }

  function handleGateReview() {
    playSfx("tap");
    haptic("light");
    // 会话保留（不清除 activeLesson），复习完回来无缝续课
    router.push("/review/");
  }

  function handleGateExit() {
    playSfx("tap");
    haptic("medium");
    setGateOpen(false);
    // 遮罩承诺过「回来接着上次继续」→ 保留 activeLesson 直接返回（与 iOS onQuit 一致）。
    // 绝不能走 setFailed(true)：那会连带清掉整节课的进度。
    router.push(`/book/${lesson.bookId}/`);
  }

  // ============ 首次加载占位（等待 persist 恢复）============
  if (!ready) {
    return (
      <main className="min-h-screen bg-bg-soft flex items-center justify-center">
        <Mascot mood="think" size={100} />
      </main>
    );
  }

  // ============ 完成页 ============
  if (done && sessionStats) {
    return (
      <CompletionScreen
        lesson={lesson}
        stats={sessionStats}
        onBack={() => router.push(`/book/${lesson.bookId}/`)}
      />
    );
  }

  // ============ 失败页 ============
  if (failed) {
    return (
      <FailScreen
        lesson={lesson}
        onRetry={resetSession}
        onBack={() => router.push(`/book/${lesson.bookId}/`)}
      />
    );
  }

  // ============ 知识点讲解（首次进入） ============
  if (showIntro && lesson.knowledge) {
    return (
      <IntroCard
        lesson={lesson}
        knowledge={lesson.knowledge}
        onStart={() => setShowIntro(false)}
        onExit={() => router.push(`/book/${lesson.bookId}/`)}
      />
    );
  }

  if (!current) {
    // 数据异常兜底（题目为空的课程）
    return (
      <main className="min-h-screen bg-bg-soft flex items-center justify-center">
        <Mascot mood="think" size={100} />
      </main>
    );
  }

  // ============ 答题中 ============
  return (
    <motion.main
      animate={shakeControls}
      className="lesson-canvas h-screen flex flex-col relative"
      style={backdropStyle}
    >
      {/* +XP 飘字层 —— fixed 定位独立于 layout，不影响滚动 */}
      <div className="pointer-events-none fixed inset-0 z-50">
        <AnimatePresence>
          {xpFloats.map(f => (
            <motion.div
              key={f.id}
              initial={{
                x: f.startX,
                y: f.startY,
                opacity: 0,
                scale: 0.4,
              }}
              animate={{
                x: [f.startX, (f.startX + f.endX) / 2, f.endX],
                y: [f.startY, f.startY - 30, f.endY],
                opacity: [0, 1, 1, 0],
                scale: [0.4, 1.25, 1.05, 0.7],
              }}
              transition={{ duration: 0.95, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
              onAnimationComplete={() =>
                setXpFloats(list => list.filter(x => x.id !== f.id))
              }
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-secondary to-secondary-dark text-white font-extrabold text-base"
              style={{
                boxShadow: "0 4px 0 0 #0d7aa8, 0 0 20px rgba(28, 176, 246, 0.4)",
                top: 0,
                left: 0,
              }}
            >
              <Lightning className="w-4 h-4" />
              +{xpPerCorrectShown}
              {isExam && (
                <span className="ml-0.5 text-[10px] font-extrabold bg-white/25 rounded-full px-1.5 py-0.5">
                  挑战×2
                </span>
              )}
              {weekend && (
                <span className="ml-0.5 text-[10px] font-extrabold bg-white/25 rounded-full px-1.5 py-0.5">
                  周末×2
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 大型 Combo Overlay —— 首次连击时才 mount，避免冷启动加载 */}
      {comboMounted && (
        <ComboOverlay
          triggerKey={comboOverlay?.key ?? 0}
          combo={comboOverlay?.combo ?? 0}
          visible={!!comboOverlay}
        />
      )}

      {/* 退出确认 —— 用户第一次点关闭按钮时才 mount */}
      {exitConfirmMounted && (
      <Modal open={showExitConfirm} onClose={() => setShowExitConfirm(false)}>
        <div className="flex flex-col items-center text-center">
          <Mascot mood="sad" size={96} />
          <h2 className="text-2xl font-extrabold text-ink mt-3">你确定要退出吗？</h2>
          <p className="text-ink-light mt-2 mb-5">退出就会失去本节课的全部进度。</p>
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={() => {
                playSfx("tap");
                haptic("light");
                setShowExitConfirm(false);
              }}
              className="btn-chunky-primary w-full"
            >
              继续学习
            </button>
            <button
              onClick={handleConfirmExit}
              className="btn-chunky-danger w-full"
            >
              退出
            </button>
          </div>
        </div>
      </Modal>
      )}

      {/* 💔 断心遮罩（web-lesson-5）：0 心 + 看完反馈点继续时弹出，不清会话 */}
      {gateMounted && (
      <Modal open={gateOpen} dismissible={false} ariaLabel="红心用完了">
        <div className="flex flex-col items-center text-center">
          <Mascot mood="sad" size={96} />
          <h2 className="text-2xl font-extrabold text-ink mt-3">红心用完了！</h2>
          <p className="text-ink-light mt-2">
            补满红心继续闯关，或者去复习错题回心～
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-extrabold text-secondary-dark">
            <Gem className="w-4 h-4" />
            <span className="tabular-nums">当前宝石 {gems}</span>
          </div>
          <div className="flex flex-col gap-3 w-full mt-5">
            <button
              onClick={handleGateRefill}
              disabled={gems < HEART_REFILL_COST}
              className={
                gems >= HEART_REFILL_COST
                  ? "btn-chunky-primary w-full"
                  : "btn-chunky-disabled w-full"
              }
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Gem className="w-4 h-4" />
                用 {HEART_REFILL_COST} 宝石补满继续
              </span>
            </button>
            {gems < HEART_REFILL_COST && (
              <p className="text-xs text-ink-softer -mt-1">宝石不够，先去复习错题回心吧</p>
            )}
            <button onClick={handleGateReview} className="btn-chunky-secondary w-full">
              去复习错题回心
            </button>
            <p className="text-xs text-ink-softer -mt-1">做完复习回来，这节课会接着上次继续</p>
            <button onClick={handleGateExit} className="btn-chunky-ghost w-full">
              先退出，进度帮你留着
            </button>
          </div>
        </div>
      </Modal>
      )}

      {/* ⚙️ 移动端设置小弹层（web-lesson-9）：音效 / 自动朗读 */}
      {settingsMounted && (
      <Modal open={showSettings} onClose={() => setShowSettings(false)} ariaLabel="课程设置">
        <div className="flex flex-col">
          <h2 className="text-xl font-extrabold text-ink text-center mb-4">课程设置</h2>
          <div className="flex items-center justify-between py-3 border-b border-bg-softer">
            <span className="font-bold text-ink">自动朗读</span>
            <AutoNarrateToggle />
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="font-bold text-ink">音效</span>
            <MuteToggle />
          </div>
          <button
            onClick={() => {
              playSfx("tap");
              haptic("light");
              setShowSettings(false);
            }}
            className="btn-chunky-primary w-full mt-4"
          >
            好了
          </button>
        </div>
      </Modal>
      )}

      {/* Top bar: close, progress, combo, XP, hearts */}
      <div className="bg-white border-b border-bg-softer">
        <div className="max-w-md lg:max-w-2xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleRequestExit}
            className="h-9 w-9 -ml-1 inline-flex items-center justify-center rounded-full text-ink-light hover:text-ink hover:bg-bg-softer transition-colors shrink-0"
            aria-label="退出课程"
          >
            <Close className="w-5 h-5" />
          </button>
          <div className="flex-1 h-3 bg-bg-softer rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full origin-left"
              animate={progressControls}
              initial={{ width: "0%" }}
              style={{ boxShadow: "inset 0 2px 0 rgba(255,255,255,0.35)" }}
            />
          </div>

          {/* Combo 徽章（顶栏） */}
          <AnimatePresence>
            {combo >= 3 && (
              <motion.div
                key={combo}
                initial={{ scale: 0, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", damping: 12, stiffness: 260 }}
                className="h-8 px-2.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-warning to-gold text-white font-extrabold text-sm shadow-md tabular-nums"
              >
                <Flame className="w-4 h-4" />
                x{combo}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 本节已得 XP 徽章（飘字目标）—— 周末按 ×2 显示并挂角标 */}
          <motion.div
            ref={xpTargetRef}
            animate={
              sessionXp > 0
                ? { scale: [1, 1.22, 1] }
                : { scale: 1 }
            }
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative h-8 px-2.5 inline-flex items-center gap-1 rounded-full border-2 border-secondary/40 text-secondary-dark bg-secondary/10 font-extrabold text-sm select-none tabular-nums"
            aria-label="本节已得 XP"
          >
            <Lightning className="w-4 h-4" />
            <span>{sessionXp * xpMultiplier}</span>
            {xpMultiplier > 1 && (
              <span
                className="absolute -top-2 -right-2 text-[9px] leading-none font-extrabold text-white rounded-full px-1.5 py-0.5"
                style={{
                  background: isExam
                    ? "linear-gradient(135deg, #CE82FF, #7C3AED)"
                    : "linear-gradient(135deg, #1CB0F6, #1899D6)",
                  boxShadow: isExam ? "0 2px 0 0 #6b21a8" : "0 2px 0 0 #0d7aa8",
                }}
                aria-label={
                  isExam && weekend
                    ? "挑战 + 周末双倍 XP"
                    : isExam
                      ? "单元挑战双倍 XP"
                      : "周末双倍 XP"
                }
              >
                ×{xpMultiplier}
              </span>
            )}
          </motion.div>

          {/* 桌面端（lg+）：完整红心条 + 回心倒计时 + 朗读/音效开关 */}
          <div className="hidden lg:flex items-center gap-2">
            <HeartsBar total={MAX_HEARTS} remaining={hearts} />
            <HeartTimer />
            <AutoNarrateToggle />
            <MuteToggle />
          </div>

          {/* 移动端（<lg）：❤️×N 单徽章 + 齿轮设置，进度条重回视觉主角 */}
          <div className="flex lg:hidden items-center gap-1.5">
            <div
              className={cn(
                "h-8 px-2 inline-flex items-center gap-0.5 rounded-full border-2 font-extrabold text-sm tabular-nums select-none",
                hearts > 0
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-bg-softer bg-bg-soft text-ink-softer",
              )}
              aria-label={`剩余 ${hearts} 颗红心`}
            >
              <Heart className={cn("w-4 h-4", hearts > 0 && "fill-current")} />
              <span>×{hearts}</span>
            </div>
            {hearts === 0 && <HeartTimer />}
            <button
              type="button"
              onClick={() => {
                playSfx("tap");
                haptic("light");
                setSettingsMounted(true);
                setShowSettings(true);
              }}
              className="h-8 w-8 inline-flex items-center justify-center rounded-full text-ink-light hover:text-ink hover:bg-bg-softer transition-colors"
              aria-label="课程设置"
            >
              <GearIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 三星距离提示（动态：剩 N 题就三星 / 二星，临近时会更激励） */}
      <StarDistanceHint
        correctCount={correctCount}
        answered={answeredFirst}
        total={total}
      />

      

      {/* Question area */}
      <div className="flex-1 flex flex-col items-center justify-start px-5 pb-4 overflow-auto">
        {/* 吉祥物 + 气泡 */}
        <div className="max-w-md lg:max-w-2xl mx-auto w-full pb-2 flex items-end gap-3 min-h-[96px]">
          <Mascot
            mood={phase === "checked" ? mascotMood : "happy"}
            size={72}
            reactTo={mascotReact}
            reactKey={mascotReactKey}
          />
          <div className="mb-2 h-8 flex items-end">
            <AnimatePresence mode="wait">
              {bubbleText && (
                <SpeechBubble key={bubbleKey} text={bubbleText} tone={bubbleTone} />
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="w-full max-w-md lg:max-w-2xl">
          {/* "NEW WORD" 紫色胶囊 tag —— 仿 Duolingo 题型标签 */}
          <div className="mb-3 inline-flex items-center gap-1.5 flex-wrap">
            {/* ⚔️ 单元挑战徽章（紫金） */}
            {isExam && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white text-[11px] font-extrabold tracking-wider"
                style={{
                  background: "linear-gradient(135deg, #CE82FF, #7C3AED)",
                  border: "1.5px solid #FFC800",
                }}
              >
                ⚔️ 单元挑战
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/10 text-secondary-dark text-[11px] font-extrabold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              {questionTagLabel(current.type)}
            </span>
            {/* 错题重答提示：这题之前答错过，重排回来了 */}
            {attemptedRef.current.has(current.id) && phase === "answering" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warning/15 text-warning text-[11px] font-extrabold">
                <Flame className="w-3 h-3" />
                再试一次
              </span>
            )}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={serveKey}
              initial={{ x: 30, y: 8, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              exit={{ x: -30, y: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 240 }}
            >
              <QuestionRenderer
                question={current}
                answer={answer}
                phase={phase}
                isCorrect={isCorrect}
                onChange={setAnswer}
                locked={locked}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* a11y: 屏幕阅读器实时播报答题结果（仅 sr-only） */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {phase === "checked" && isCorrect === true && `回答正确。${current.explanation ?? ""}`}
        {phase === "checked" && isCorrect === false &&
          `回答错误。正确答案是：${current.answer}。${current.explanation ?? ""}`}
      </div>

      {/* Bottom: SKIP / CHECK 双按钮（仿 Duolingo 真机底栏） */}
      {phase === "answering" && (
        <div className="bg-white border-t-2 border-bg-softer">
          <div className="max-w-md lg:max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
            <button
              type="button"
              onClick={skipQuestion}
              className="btn-chunky-ghost px-6"
              aria-label="跳过本题"
            >
              跳过
            </button>
            <button
              onClick={handleCheck}
              disabled={!answer.trim()}
              className={answer.trim() ? "flex-1 btn-chunky-primary" : "flex-1 btn-chunky-disabled"}
            >
              检查
            </button>
          </div>
        </div>
      )}

      {phase === "checked" && (
        <FeedbackPanel
          isCorrect={isCorrect ?? false}
          explanation={current.explanation}
          explanationAudio={current.audio?.explanation ?? null}
          onContinue={handleContinue}
          reportContext={{
            lessonId: lesson.id,
            question: current,
            userAnswer: answer || undefined,
          }}
        />
      )}
    </motion.main>
  );
}

// ============================================================
// 完成 / 失败子页
// ============================================================

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);
  return value;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function todayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 结算序列（web-lesson-6 / web-economy-7 / E1 挑战幕）—— 多幕节拍：
 *   1. stars   星星揭示（+完美/首三星/挑战双倍/周末徽章）
 *   2. conquer 单元征服幕（挑战课 accuracy ≥ 0.8 时）
 *   3. streak  连胜幕（当日首课推进连胜时；里程碑大庆祝）
 *   4. goal    每日目标达成幕（本次跨过目标时，+20💎）
 *   5. stats   统计卡（XP 实际入账值 / 宝石全额，宝箱另计弹窗）
 *   6. quests  任务进度幕（before → after 推进动画）
 * 每幕 Enter / 点击继续，幕间音效错峰。
 */
type CompletionAct = "stars" | "conquer" | "streak" | "goal" | "stats" | "quests";

function CompletionScreen({
  lesson,
  stats,
  onBack,
}: {
  lesson: Lesson;
  stats: SessionStats;
  onBack: () => void;
}) {
  const { outcome } = stats;
  const acts = useMemo<CompletionAct[]>(() => {
    const a: CompletionAct[] = ["stars"];
    if (stats.conquered) a.push("conquer");
    if (outcome.streakIncreased) a.push("streak");
    if (outcome.dailyGoalReachedNow) a.push("goal");
    a.push("stats", "quests");
    return a;
  }, [outcome, stats.conquered]);
  const [actIdx, setActIdx] = useState(0);
  const act = acts[actIdx];
  const isLast = actIdx >= acts.length - 1;

  function advance() {
    playSfx("tap");
    haptic("light");
    if (isLast) {
      onBack();
      return;
    }
    setActIdx(i => i + 1);
  }

  // Enter / 空格 推进当前幕（焦点在按钮上时交给原生 click）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e)) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      if (isButtonTarget(e)) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main className="min-h-screen bg-bg-soft flex flex-col items-center justify-center px-5 relative overflow-hidden">
      {(act === "stars" ||
        act === "conquer" ||
        (act === "streak" && outcome.milestoneGems > 0)) && (
        <ConfettiCanvas active />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={act}
          initial={{ x: 40, opacity: 0, scale: 0.97 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: -40, opacity: 0, scale: 0.97 }}
          transition={{ type: "spring", damping: 20, stiffness: 240 }}
          className="w-full max-w-md relative z-10"
        >
          {act === "stars" && <StarsAct lesson={lesson} stats={stats} onContinue={advance} />}
          {act === "conquer" && <ConquerAct lesson={lesson} onContinue={advance} />}
          {act === "streak" && <StreakAct outcome={outcome} onContinue={advance} />}
          {act === "goal" && <GoalAct onContinue={advance} />}
          {act === "stats" && <StatsAct stats={stats} onContinue={advance} />}
          {act === "quests" && (
            <QuestsAct quests={stats.quests} onContinue={advance} />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function ActContinueButton({
  label = "继续",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      autoFocus
      onClick={onClick}
      className="btn-chunky-primary mt-8 px-12 mx-auto block"
    >
      {label}
    </button>
  );
}

/** 第 1 幕：星星揭示 + 完美/首三星/周末徽章 */
function StarsAct({
  lesson,
  stats,
  onContinue,
}: {
  lesson: Lesson;
  stats: SessionStats;
  onContinue: () => void;
}) {
  const { outcome, perfect, weekend, isExam } = stats;
  const stars = outcome.stars;
  const [revealedStars, setRevealedStars] = useState(0);
  const [mascotReactKey, setMascotReactKey] = useState(0);
  // 15% 偶发"超级庆祝" —— 仅在 perfect 通关时有可能触发
  const [superCelebration] = useState(() => perfect && Math.random() < 0.15);

  useEffect(() => {
    playSfx("complete");
    // 星星揭晓完毕后播"完成!"语音（延迟到动画尾声，不抢音效节奏）
    const voiceTimer = setTimeout(() => {
      void playTTS(uiAudio("完成!"));
    }, 500 + 3 * 380 + 200);
    // 超级庆祝：再叠加一次 unlock 音效 + 多一次 mascot react
    let superTimer: ReturnType<typeof setTimeout> | null = null;
    if (superCelebration) {
      superTimer = setTimeout(() => {
        playSfx("unlock");
        haptic("success");
        setMascotReactKey(k => k + 1);
      }, 500 + 3 * 380 + 400);
    }
    const t0 = setTimeout(() => setMascotReactKey(k => k + 1), 120);
    const starTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < stars; i++) {
      const t = setTimeout(
        () => {
          setRevealedStars(s => s + 1);
          playSfx("star");
          haptic("light");
        },
        500 + i * 380,
      );
      starTimers.push(t);
    }
    return () => {
      clearTimeout(voiceTimer);
      clearTimeout(t0);
      if (superTimer) clearTimeout(superTimer);
      starTimers.forEach(clearTimeout);
    };
  }, [stars, superCelebration]);

  return (
    <div className="text-center">
      {/* 超级庆祝彩带 —— 15% 偶发，让幸运的玩家感觉"赚到了" */}
      <AnimatePresence>
        {superCelebration && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 1.4, type: "spring", damping: 14, stiffness: 240 }}
            className="inline-flex items-center gap-2 px-5 py-3 mb-3 rounded-full text-white font-extrabold text-base"
            style={{
              background: "linear-gradient(135deg, #FFC800, #FF6B6B, #CE82FF)",
              backgroundSize: "200% 100%",
              boxShadow: "0 5px 0 0 #A560E8, 0 0 30px rgba(255, 200, 0, 0.6)",
            }}
          >
            <Confetti className="w-5 h-5" />
            <span>太厉害了！完美通关！</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ scale: 0.6, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 16, stiffness: 220 }}
      >
        <Mascot mood="cheer" size={150} reactTo="levelup" reactKey={mascotReactKey} />
        <motion.h1
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl font-extrabold text-primary mt-4"
        >
          完成!
        </motion.h1>
        <p className="text-ink-light mt-2">{lesson.title}</p>

        {/* 完美标徽 */}
        <AnimatePresence>
          {perfect && (
            <motion.div
              initial={{ scale: 0, rotate: -20, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ delay: 0.5, type: "spring", damping: 12 }}
              className="inline-flex items-center gap-1.5 h-7 px-3 mt-3 rounded-full font-extrabold text-sm text-white"
              style={{
                background: "linear-gradient(135deg, #FFC800, #FF9600)",
                boxShadow: "0 4px 0 0 #C89600",
              }}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
              <span>零失误 +{PERFECT_XP_BONUS} XP</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 首次完美额外奖励 */}
        <AnimatePresence>
          {outcome.isFirstPerfect && (
            <motion.div
              initial={{ scale: 0, y: 6, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ delay: 0.7, type: "spring", damping: 12 }}
              className="inline-flex items-center gap-1.5 h-7 px-3 mt-2 ml-2 rounded-full font-extrabold text-sm text-white"
              style={{
                background: "linear-gradient(135deg, #1CB0F6, #1899D6)",
                boxShadow: "0 4px 0 0 #0d7aa8",
              }}
            >
              <Sparkle className="w-3.5 h-3.5" />
              <span>首次三星 +{FIRST_PERFECT_XP_BONUS} XP</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ⚔️ 挑战双倍徽章 —— 单元挑战 XP 总额已按 ×2 入账 */}
        <AnimatePresence>
          {isExam && (
            <motion.div
              initial={{ scale: 0, y: 6, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ delay: 0.8, type: "spring", damping: 12 }}
              className="inline-flex items-center gap-1.5 h-7 px-3 mt-2 ml-2 rounded-full font-extrabold text-sm text-white"
              style={{
                background: "linear-gradient(135deg, #CE82FF, #7C3AED)",
                boxShadow: "0 4px 0 0 #6B21A8",
                border: "2px solid #FFC800",
              }}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>挑战双倍 ×{EXAM_XP_MULTIPLIER}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 周末双倍徽章 —— 总额已按 ×2 入账，所见即所得 */}
        <AnimatePresence>
          {weekend && (
            <motion.div
              initial={{ scale: 0, y: 6, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              transition={{ delay: 0.85, type: "spring", damping: 12 }}
              className="inline-flex items-center gap-1.5 h-7 px-3 mt-2 ml-2 rounded-full font-extrabold text-sm text-white"
              style={{
                background: "linear-gradient(135deg, #1CB0F6, #1899D6)",
                boxShadow: "0 4px 0 0 #0d7aa8",
              }}
            >
              <Confetti className="w-3.5 h-3.5" />
              <span>周末双倍 ×2</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-center gap-4 mt-6">
          {[1, 2, 3].map(i => {
            const earned = i <= stars;
            const shown = i <= revealedStars;
            return (
              <motion.div
                key={i}
                initial={{ scale: 0, rotate: -180 }}
                animate={shown ? { scale: 1, rotate: 0 } : { scale: 0.4, rotate: -180, opacity: 0.3 }}
                transition={{ type: "spring", damping: 10, stiffness: 220 }}
                className={earned && shown ? "text-gold" : "text-bg-softer"}
                style={
                  earned && shown
                    ? { filter: "drop-shadow(0 4px 12px rgba(255,200,0,0.6))" }
                    : undefined
                }
              >
                <Star className="w-16 h-16 fill-current" strokeWidth={1.5} />
              </motion.div>
            );
          })}
        </div>

        {/* 📤 三星分享卡（E2）：本地 canvas 渲染，系统分享/降级下载 */}
        {stars === 3 && (
          <ShareCardButton
            makeBlob={() =>
              renderBadgeCard({
                heading: "三星通关",
                title: lesson.title,
                subtitle: `第 ${lesson.unitNumber} 单元 · ${lesson.unitTitle}`,
                stars: 3,
              })
            }
            filename={`sanxing-${lesson.id}.png`}
            shareText={`我在聪聪学堂三星通关了「${lesson.title}」！`}
            className="btn-chunky-secondary px-10 mx-auto block mt-6"
          />
        )}

        <ActContinueButton onClick={onContinue} />
      </motion.div>
    </div>
  );
}

/** ⚔️ 单元征服幕：挑战课 accuracy ≥ 0.8 —— 金色奖杯大庆祝 */
function ConquerAct({
  lesson,
  onContinue,
}: {
  lesson: Lesson;
  onContinue: () => void;
}) {
  useEffect(() => {
    playSfx("unlock");
    haptic("success");
    const t = setTimeout(() => playSfx("star"), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.3, rotate: -15, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 9, stiffness: 200 }}
        className="inline-block text-gold"
        style={{ filter: "drop-shadow(0 8px 28px rgba(255,200,0,0.6))" }}
      >
        <Trophy className="w-28 h-28" />
      </motion.div>
      <motion.h2
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="text-4xl font-extrabold mt-4"
        style={{
          background: "linear-gradient(135deg, #FFC800, #FF9600)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        单元征服！
      </motion.h2>
      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-ink-light mt-2"
      >
        {lesson.unitTitle}的挑战被你拿下啦，奖杯变成金色了！
      </motion.p>
      <motion.div
        initial={{ scale: 0, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ delay: 0.55, type: "spring", damping: 11 }}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-sm font-extrabold"
        style={{
          background: "linear-gradient(135deg, #CE82FF, #7C3AED)",
          boxShadow: "0 4px 0 0 #6B21A8",
          border: "2px solid #FFC800",
        }}
      >
        ⚔️ 第 {lesson.unitNumber} 单元 · 征服达成
      </motion.div>
      <ActContinueButton onClick={onContinue} />
    </div>
  );
}

/** 第 2 幕：连胜幕 —— 大火焰 + 本周 7 格日历 + 里程碑大庆祝 */
function StreakAct({
  outcome,
  onContinue,
}: {
  outcome: LessonOutcome;
  onContinue: () => void;
}) {
  const xpHistory = useProgressStore(s => s.xpHistory);
  const week = useMemo(() => {
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7; // 0 = 周一
    const labels = ["一", "二", "三", "四", "五", "六", "日"];
    return labels.map((label, i) => {
      const key = todayKey(i - mondayOffset);
      return {
        label,
        key,
        isToday: i === mondayOffset,
        active: (xpHistory[key] ?? 0) > 0,
      };
    });
  }, [xpHistory]);

  useEffect(() => {
    playSfx("combo");
    haptic("success");
    let t: ReturnType<typeof setTimeout> | null = null;
    if (outcome.milestoneGems > 0) {
      t = setTimeout(() => {
        playSfx("unlock");
        haptic("success");
      }, 650);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [outcome.milestoneGems]);

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.3, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 10, stiffness: 200 }}
        className="inline-block text-warning"
        style={{ filter: "drop-shadow(0 8px 24px rgba(255,150,0,0.5))" }}
      >
        <Flame className="w-28 h-28" />
      </motion.div>
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        <div className="text-5xl font-extrabold text-warning tabular-nums">
          {outcome.streakAfter} 天
        </div>
        <div className="text-xl font-extrabold text-ink mt-1">连续学习！</div>
      </motion.div>

      {/* 本周 7 格日历（xpHistory 渲染） */}
      <motion.div
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mt-6 bg-white rounded-2xl border-2 border-bg-softer p-4"
        style={{ boxShadow: "0 4px 0 0 var(--shadow-card-color)" }}
      >
        <div className="grid grid-cols-7 gap-2">
          {week.map((d, i) => (
            <div key={d.key} className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-extrabold text-ink-softer">{d.label}</span>
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5 + i * 0.06, type: "spring", damping: 14 }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center",
                  d.active ? "bg-warning text-white" : "bg-bg-softer text-ink-softer",
                  d.isToday && "ring-4 ring-warning/30",
                )}
              >
                {d.active ? (
                  <Flame className="w-4 h-4" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-white/70" />
                )}
              </motion.div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 连胜里程碑大庆祝（3/7/14/30/60/100 天，已入账另展示） */}
      <AnimatePresence>
        {outcome.milestoneGems > 0 && (
          <motion.div
            initial={{ scale: 0, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ delay: 0.65, type: "spring", damping: 11, stiffness: 220 }}
            className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-extrabold text-xl text-white"
            style={{
              background: "linear-gradient(135deg, #FFC800, #FF9600)",
              boxShadow: "0 5px 0 0 #C89600, 0 0 30px rgba(255,200,0,0.5)",
            }}
          >
            <Confetti className="w-6 h-6" />
            <span>
              里程碑奖励 +{outcome.milestoneGems}
            </span>
            <Gem className="w-6 h-6" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 📤 连胜分享卡（E2）：品牌绿底 + 聪聪 + 大火焰数字 + 本周日历 */}
      <ShareCardButton
        makeBlob={() =>
          renderStreakCard({
            streak: outcome.streakAfter,
            week: buildShareWeek(xpHistory),
          })
        }
        filename={`liansheng-${outcome.streakAfter}tian.png`}
        shareText={`我已经在聪聪学堂连续学习 ${outcome.streakAfter} 天啦！`}
        className="btn-chunky-secondary px-10 mx-auto block mt-6 mr-6"
      />

      <ActContinueButton onClick={onContinue} />
    </div>
  );
}

/** 第 3 幕：每日目标达成幕 */
function GoalAct({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    playSfx("star");
    haptic("success");
  }, []);

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.3, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 10, stiffness: 200 }}
        className="inline-block text-primary"
        style={{ filter: "drop-shadow(0 8px 24px rgba(88,204,2,0.4))" }}
      >
        <Target className="w-24 h-24" />
      </motion.div>
      <motion.h2
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-3xl font-extrabold text-primary mt-4"
      >
        今日目标达成！
      </motion.h2>
      <motion.div
        initial={{ scale: 0, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ delay: 0.45, type: "spring", damping: 11 }}
        className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-extrabold text-2xl text-white"
        style={{
          background: "linear-gradient(135deg, #1CB0F6, #1899D6)",
          boxShadow: "0 5px 0 0 #0d7aa8",
        }}
      >
        <Gem className="w-7 h-7" />
        <span className="tabular-nums">+{DAILY_GOAL_BONUS}</span>
      </motion.div>
      <p className="text-ink-light mt-4">坚持每天学一点，进步看得见！</p>
      <ActContinueButton onClick={onContinue} />
    </div>
  );
}

/** 第 4 幕：统计卡（XP 实际入账值 / 宝石全额；宝箱另计弹窗） */
function StatsAct({
  stats,
  onContinue,
}: {
  stats: SessionStats;
  onContinue: () => void;
}) {
  const { outcome, accuracy, maxCombo, durationSec, chestReward } = stats;
  const [chestOpen, setChestOpen] = useState(false);
  const xpDisplay = useCountUp(outcome.xpGained, 900);
  const accDisplay = useCountUp(Math.round(accuracy * 100), 900);
  const gemsDisplay = useCountUp(outcome.gemsGained, 900);

  useEffect(() => {
    playSfx("progressTick");
    // 命中宝箱：统计卡出场后自动弹宝箱弹窗
    let t: ReturnType<typeof setTimeout> | null = null;
    if (chestReward) {
      t = setTimeout(() => setChestOpen(true), 800);
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [chestReward]);

  return (
    <div className="text-center">
      <Mascot mood="cheer" size={110} />
      <h2 className="text-2xl font-extrabold text-ink mt-3">本节课收获</h2>
      <div className="mt-6 grid gap-3 grid-cols-2">
        <StatCard label="经验值" value={`+${Math.round(xpDisplay)}`} color="text-secondary" />
        <StatCard
          label="宝石"
          value={`+${Math.round(gemsDisplay)}`}
          color="text-secondary-dark"
          icon="gem"
        />
        <StatCard label="准确率" value={`${Math.round(accDisplay)}%`} color="text-primary" />
        <StatCard
          label={maxCombo >= 3 ? "最高连击" : "用时"}
          value={maxCombo >= 3 ? `×${maxCombo}` : formatTime(durationSec)}
          color="text-warning"
        />
      </div>
      {chestReward && (
        <p className="text-xs text-ink-softer mt-3">宝箱奖励另外计算，已经放进你的口袋啦</p>
      )}

      <ActContinueButton onClick={onContinue} />

      {/* 宝箱弹窗：命中 chest slot 自动弹出 */}
      {chestReward && (
        <ChestModal
          open={chestOpen}
          gems={chestReward.gems}
          tier={chestReward.tier}
          onClose={() => setChestOpen(false)}
        />
      )}
    </div>
  );
}

/** 第 5 幕：任务进度幕 —— before → after 推进动画，完成的打勾 + 领取提示 */
function QuestsAct({
  quests,
  onContinue,
}: {
  quests: QuestSnapshot[];
  onContinue: () => void;
}) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    playSfx("progressTick");
    const t = setTimeout(() => setAnimated(true), 450);
    // 本次通关新完成的任务错峰播提示音
    const doneTimers = quests
      .filter(q => q.before < q.quest.target && q.after >= q.quest.target)
      .map((_, i) =>
        setTimeout(() => {
          playSfx("star");
          haptic("light");
        }, 900 + i * 280),
      );
    return () => {
      clearTimeout(t);
      doneTimers.forEach(clearTimeout);
    };
  }, [quests]);

  const anyClaimable = quests.some(q => q.after >= q.quest.target);

  return (
    <div className="text-center">
      <h2 className="text-2xl font-extrabold text-ink">今日任务</h2>
      <p className="text-sm text-ink-light mt-1">这节课帮你推进了这些任务</p>

      <div className="mt-5 space-y-3">
        {quests.map(({ quest, before, after }, i) => {
          const target = Math.max(1, quest.target);
          const shownValue = animated ? after : before;
          const pct = Math.min(100, (shownValue / target) * 100);
          const doneNow = after >= target;
          return (
            <motion.div
              key={quest.id}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.12 }}
              className="bg-white rounded-2xl border-2 border-bg-softer p-4 text-left"
              style={{ boxShadow: "0 4px 0 0 var(--shadow-card-color)" }}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 font-extrabold text-ink text-sm">{quest.title}</span>
                {doneNow ? (
                  <motion.span
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: animated ? 1 : 0, rotate: animated ? 0 : -90 }}
                    transition={{ delay: 0.75 + i * 0.12, type: "spring", damping: 12 }}
                    className="text-primary"
                  >
                    <CheckCircle className="w-6 h-6" />
                  </motion.span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-secondary-dark font-extrabold text-xs">
                    <Gem className="w-3.5 h-3.5" />+{quest.reward}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-3 bg-bg-softer rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      doneNow ? "bg-primary" : "bg-warning",
                    )}
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: 0.45 + i * 0.12 }}
                  />
                </div>
                <span className="text-xs font-extrabold text-ink-softer tabular-nums shrink-0">
                  {Math.min(shownValue, target)}/{target}
                </span>
              </div>
              {doneNow && (
                <div className="mt-2 text-xs font-bold text-primary-dark">
                  已完成！去首页领取 +{quest.reward} 宝石
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {anyClaimable && (
        <p className="text-xs text-ink-softer mt-3">完成的任务记得回首页领奖励哦</p>
      )}

      <ActContinueButton label="继续学习" onClick={onContinue} />
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon?: "gem";
}) {
  return (
    <div
      className="bg-white rounded-2xl p-3 border-2 border-bg-softer text-center"
      style={{ boxShadow: "0 4px 0 0 var(--shadow-card-color)" }}
    >
      <div className="text-[10px] uppercase tracking-wider text-ink-softer font-extrabold flex items-center justify-center gap-1">
        {icon === "gem" && <Gem className="w-3 h-3 text-secondary" />}
        {label}
      </div>
      <div className={`text-xl font-extrabold tabular-nums mt-1 ${color}`}>
        {value}
      </div>
    </div>
  );
}

// ============================================================
// IntroCard — 多邻国 Tips 风格的分步讲解
// 每屏只讲一件事（core_concept / key_formula / common_mistakes / tips）
// 为小朋友设计：吉祥物反应 + 多层音效 + 弹性动画 + 鼓励气泡
// ============================================================

type IntroTone = "concept" | "rule" | "mistake" | "tip";

interface IntroPage {
  tone: IntroTone;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  accent: string; // hex，用于进度点和底部装饰
  mascotMood: MascotMood; // 每页吉祥物心情
  bubbleText: string; // 吉祥物气泡鼓励语
  /** 该页要按顺序自动播的所有 TTS 音频。单字段页只有一段，mistake 页有多段。 */
  audioSrcs?: Array<string | null | undefined>;
  /** 给标题旁的 TTSButton 用的"代表音频"。单段页 = audioSrcs[0]；多段页留空，避免重复。 */
  titleAudio?: string;
  /** 自定义 render，可接收当前播放索引（仅 mistake 页用） */
  render: (playingIdx: number) => React.ReactNode;
}

function IntroCard({
  lesson,
  knowledge,
  onStart,
  onExit,
}: {
  lesson: Lesson;
  knowledge: KnowledgeSummary;
  onStart: () => void;
  onExit: () => void;
}) {
  // 动态组装存在的页面（缺字段自动跳过）
  const pages: IntroPage[] = [];
  if (knowledge.core_concept) {
    pages.push({
      tone: "concept",
      title: "这是什么？",
      icon: BookOpen,
      iconBg: "bg-secondary/15",
      iconColor: "text-secondary-dark",
      accent: "#1CB0F6",
      mascotMood: "think",
      bubbleText: "一起学！",
      audioSrcs: [knowledge.audio?.core_concept],
      titleAudio: knowledge.audio?.core_concept,
      render: () => (
        <p className="text-ink leading-relaxed text-lg">
          <MathText text={knowledge.core_concept} />
        </p>
      ),
    });
  }
  if (knowledge.key_formula) {
    pages.push({
      tone: "rule",
      title: "记住这个！",
      icon: Target,
      iconBg: "bg-primary/15",
      iconColor: "text-primary-dark",
      accent: "#58CC02",
      mascotMood: "wave",
      bubbleText: "超级重要!",
      audioSrcs: [knowledge.audio?.key_formula],
      titleAudio: knowledge.audio?.key_formula,
      render: () => (
        <div className="bg-bg-soft border-2 border-bg-softer rounded-2xl px-5 py-5 text-center">
          <div className="text-xl text-ink font-bold leading-relaxed">
            <MathText text={knowledge.key_formula} />
          </div>
        </div>
      ),
    });
  }
  if (Array.isArray(knowledge.common_mistakes) && knowledge.common_mistakes.length > 0) {
    pages.push({
      tone: "mistake",
      title: "小心这些坑！",
      icon: XCircle,
      iconBg: "bg-danger/15",
      iconColor: "text-danger-dark",
      accent: "#FF4B4B",
      mascotMood: "surprise",
      bubbleText: "别踩坑哦!",
      audioSrcs: knowledge.audio?.common_mistakes,
      render: (playingIdx: number) => (
        <ul className="space-y-3">
          {knowledge.common_mistakes.map((m, i) => {
            const isPlaying = i === playingIdx;
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-2xl px-4 py-3 border-2 transition-all duration-300",
                  isPlaying
                    ? "bg-danger/15 border-danger ring-4 ring-danger/20 scale-[1.02]"
                    : "bg-danger/5 border-danger/20",
                )}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                    isPlaying
                      ? "bg-danger text-white"
                      : "bg-danger/20 text-danger-dark",
                  )}
                >
                  <XCircle className="w-4 h-4" />
                </div>
                <div className="flex-1 text-ink leading-relaxed text-base">
                  <MathText text={m} />
                </div>
                <TTSButton
                  src={knowledge.audio?.common_mistakes?.[i] ?? null}
                  size="sm"
                  label="朗读"
                />
              </li>
            );
          })}
        </ul>
      ),
    });
  }
  if (knowledge.tips) {
    pages.push({
      tone: "tip",
      title: "学习小妙招",
      icon: Lightning,
      iconBg: "bg-warning/20",
      iconColor: "text-warning",
      accent: "#FFC800",
      mascotMood: "cheer",
      bubbleText: "你最棒!",
      audioSrcs: [knowledge.audio?.tips],
      titleAudio: knowledge.audio?.tips,
      render: () => (
        <p className="text-ink leading-relaxed text-lg">
          <MathText text={knowledge.tips} />
        </p>
      ),
    });
  }

  // 异常保护：知识点全是空的就直接开始
  useEffect(() => {
    if (pages.length === 0) onStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pageIdx, setPageIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [mascotReactKey, setMascotReactKey] = useState(0);
  // mistake 页：当前正在播的条目下标（-1 = 没在播）。
  // useAutoNarrate 给出的 idx 是过滤后的 srcs 索引，索引 0 是 bubble，所以条目 i 对应过滤后 idx (i+1)。
  const [playingMistakeIdx, setPlayingMistakeIdx] = useState(-1);
  const isLast = pageIdx >= pages.length - 1;
  const current = pages[pageIdx];

  // 翻到某一页时：先播气泡短句（"一起学！"），再依次播该页的全部音频段
  const cancelNarrate = useAutoNarrate(
    [uiAudio(current?.bubbleText ?? ""), ...(current?.audioSrcs ?? [])],
    pageIdx,
    {
      onSrcStart: idx => {
        // idx 0 是 bubble，>=1 才是内容段，对应原数组 idx-1
        setPlayingMistakeIdx(idx >= 1 ? idx - 1 : -1);
      },
      onAllDone: () => setPlayingMistakeIdx(-1),
    },
  );

  // 进入每一页时：触发吉祥物反应动画 + 分层音效
  // 注意：依赖里只放 pageIdx，不能放 current（current 是 pages[pageIdx]，每次渲染都是新对象引用，会触发无限循环）
  useEffect(() => {
    if (pages.length === 0) return;
    setMascotReactKey(k => k + 1);
    // 图标徽章弹入时再补一声轻响（和动画节拍一致）
    const t = setTimeout(() => playSfx("progressTick"), 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx]);

  function goNext() {
    cancelNarrate();
    if (isLast) {
      // 最后一步：从"学"过渡到"练"，多层音效 + 强反馈
      playSfx("unlock");
      setTimeout(() => playSfx("star"), 120);
      haptic("medium");
      setTimeout(() => haptic("heavy"), 140);
      onStart();
      return;
    }
    // 翻页：tap + star 叠加，带来清脆的"咔嗒+叮"双层反馈
    playSfx("tap");
    setTimeout(() => playSfx("star", { volume: 0.6 }), 60);
    haptic("light");
    setDirection(1);
    setPageIdx(i => i + 1);
  }

  function goPrev() {
    if (pageIdx === 0) return;
    cancelNarrate();
    playSfx("tap");
    haptic("light");
    setDirection(-1);
    setPageIdx(i => i - 1);
  }

  if (!current) return null;
  const Icon = current.icon;

  return (
    <main className="h-screen bg-bg-soft flex flex-col">
      {/* 顶栏：关闭 + 进度点 */}
      <div className="bg-white border-b border-bg-softer">
        <div className="max-w-md lg:max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              playSfx("tap");
              haptic("light");
              onExit();
            }}
            className="text-ink-light hover:text-ink transition-colors shrink-0"
            aria-label="退出课程"
          >
            <Close className="w-6 h-6" />
          </button>
          <div className="flex-1 flex items-center justify-center gap-1.5">
            {pages.map((p, i) => {
              const active = i === pageIdx;
              const done = i < pageIdx;
              return (
                <motion.span
                  key={i}
                  animate={{
                    width: active ? 24 : 8,
                    backgroundColor: done ? p.accent : active ? current.accent : "#E5E5E5",
                  }}
                  transition={{ type: "spring", damping: 22, stiffness: 260 }}
                  className="h-2 rounded-full"
                />
              );
            })}
          </div>
          <div className="text-xs font-extrabold text-ink-softer tabular-nums shrink-0 w-10 text-right">
            {pageIdx + 1}/{pages.length}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 单元 & 课程标题（小） */}
        <div className="max-w-md lg:max-w-2xl mx-auto w-full px-5 pt-3 text-center">
          <div className="text-xs font-bold text-ink-softer uppercase tracking-wide">
            第 {lesson.unitNumber} 单元 · {lesson.unitTitle}
          </div>
          <div className="text-base font-extrabold text-ink-light mt-0.5 truncate">
            {lesson.title}
          </div>
        </div>

        {/* 主内容：单页聚焦 */}
        <div className="flex-1 flex items-center px-5 py-4">
          <div className="max-w-md lg:max-w-2xl mx-auto w-full">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={pageIdx}
                custom={direction}
                initial={{ x: direction * 50, opacity: 0, scale: 0.96 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={{ x: direction * -50, opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", damping: 20, stiffness: 240 }}
                className="flex flex-col items-center text-center"
              >
                {/* 吉祥物 + 气泡 */}
                <div className="flex items-end gap-2 mb-2 min-h-[96px]">
                  <motion.div
                    initial={{ y: 14, scale: 0.8, opacity: 0 }}
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    transition={{ type: "spring", damping: 12, stiffness: 220, delay: 0.05 }}
                  >
                    <Mascot
                      mood={current.mascotMood}
                      size={84}
                      reactTo="levelup"
                      reactKey={mascotReactKey}
                    />
                  </motion.div>
                  <motion.div
                    initial={{ y: 8, scale: 0, opacity: 0 }}
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    transition={{ type: "spring", damping: 14, stiffness: 240, delay: 0.18 }}
                    className="mb-3"
                  >
                    <SpeechBubble
                      text={current.bubbleText}
                      tone={
                        current.tone === "mistake"
                          ? "danger"
                          : current.tone === "concept" || current.tone === "rule"
                          ? "primary"
                          : "neutral"
                      }
                    />
                  </motion.div>
                </div>

                {/* 图标徽章 + 脉冲光环 */}
                <motion.div
                  initial={{ scale: 0.5, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", damping: 10, stiffness: 220, delay: 0.12 }}
                  className="relative mb-4"
                >
                  {/* 脉冲光圈 */}
                  <motion.div
                    aria-hidden
                    animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: `${current.accent}33` }}
                  />
                  {/* 悬浮漂浮的图标圆 */}
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    className={`relative w-20 h-20 rounded-full ${current.iconBg} flex items-center justify-center`}
                    style={{ boxShadow: `0 6px 0 0 ${current.accent}44` }}
                  >
                    <motion.div
                      animate={{ rotate: [0, -6, 6, -4, 4, 0] }}
                      transition={{ duration: 0.9, delay: 0.3 }}
                    >
                      <Icon className={`w-10 h-10 ${current.iconColor}`} />
                    </motion.div>
                  </motion.div>
                </motion.div>

                {/* 标题 */}
                <motion.div
                  initial={{ y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", damping: 16, stiffness: 260, delay: 0.2 }}
                  className="flex items-center justify-center gap-3 mb-4"
                >
                  <h1 className="text-3xl font-extrabold text-ink leading-tight">
                    {current.title}
                  </h1>
                  {current.titleAudio && (
                    <TTSButton src={current.titleAudio} label="朗读讲解" />
                  )}
                </motion.div>

                {/* 内容（继承父级居中） */}
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.28, duration: 0.35 }}
                  className="w-full max-w-prose mx-auto"
                >
                  {current.render(playingMistakeIdx)}
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 底部：上一步 + 主按钮 */}
      <div className="bg-white border-t-2 border-bg-softer">
        <div className="max-w-md lg:max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          {pageIdx > 0 ? (
            <motion.button
              type="button"
              onClick={goPrev}
              whileTap={{ scale: 0.94 }}
              aria-label="上一步"
              className="btn-chunky-ghost shrink-0 !px-4 text-xl"
            >
              ←
            </motion.button>
          ) : null}
          <motion.button
            type="button"
            onClick={goNext}
            whileTap={{ scale: 0.96 }}
            animate={
              isLast
                ? {
                    // 最后一页：按钮带呼吸式光晕 + 上下弹跳
                    y: [0, -2, 0],
                    boxShadow: [
                      "0 4px 0 0 #58A700, 0 0 0 0 rgba(88,204,2,0.6)",
                      "0 4px 0 0 #58A700, 0 0 0 14px rgba(88,204,2,0)",
                      "0 4px 0 0 #58A700, 0 0 0 0 rgba(88,204,2,0.6)",
                    ],
                  }
                : {}
            }
            transition={
              isLast
                ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
                : undefined
            }
            className="flex-1 btn-chunky-primary flex items-center justify-center gap-2"
          >
            {isLast && <Rocket className="w-5 h-5" />}
            <span>{isLast ? "开始练习" : "下一步"}</span>
            <motion.span
              aria-hidden
              animate={{ x: [0, 6, 0] }}
              transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
              className="inline-block"
            >
              →
            </motion.span>
          </motion.button>
        </div>
      </div>
    </main>
  );
}

function FailScreen({
  lesson,
  onRetry,
  onBack,
}: {
  lesson: Lesson;
  onRetry: () => void;
  onBack: () => void;
}) {
  const now = useProgressTicker();
  const hearts = useProgressStore(s => s.hearts);
  const nextHeartAt = useProgressStore(s => s.nextHeartAt);
  const canRetry = hearts > 0;
  const msToNext = nextHeartAt ? Math.max(0, nextHeartAt - now) : 0;

  return (
    <main className="min-h-screen bg-bg-soft flex flex-col items-center justify-center px-5">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 18 }}
        className="flex flex-col items-center"
      >
        <Mascot mood="sad" size={140} />
        <h1 className="text-3xl font-extrabold text-danger mt-4">
          {canRetry ? "没关系，再来一次！" : "红心用完啦"}
        </h1>
        <p className="text-ink-light mt-2 mb-4">{lesson.title}</p>

        {!canRetry && nextHeartAt && (
          <div className="mb-6 text-center">
            <p className="text-sm text-ink-light">下一颗心还需</p>
            <div className="text-3xl font-extrabold text-danger tabular-nums mt-1">
              {formatMsCountdown(msToNext)}
            </div>
            <p className="text-xs text-ink-softer mt-1">每 5 分钟恢复 1 颗心</p>
          </div>
        )}

        <div className="flex flex-col gap-3 w-64">
          <button
            onClick={() => {
              if (!canRetry) return;
              playSfx("unlock");
              haptic("medium");
              onRetry();
            }}
            disabled={!canRetry}
            className={canRetry ? "btn-chunky-primary" : "btn-chunky-disabled"}
          >
            重新开始
          </button>
          <button
            onClick={() => {
              playSfx("tap");
              haptic("light");
              onBack();
            }}
            className="btn-chunky-ghost"
          >
            返回路径
          </button>
        </div>
      </motion.div>
    </main>
  );
}
