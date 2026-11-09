export type AgentEmotion =
  | 'idle'
  | 'thinking'
  | 'coding'
  | 'smug'
  | 'shocked'
  | 'touched';

export type TouchZone = 'head' | 'accessory' | 'body';

export interface AgentCharacter {
  id: 'opus-5-5' | 'gemini-4';
  codename: string;
  title: string;
  stars: number;
  personaName: string;
  attribute: string;
  role: string;
  themeColor: string;
  personality: string;
  catchphrases: {
    greeting: string;
    thinking: string[];
    coding: string[];
    victory: string[];
    error: string[];
  };
  touchReactions: Record<TouchZone, { emotion: AgentEmotion; line: string }>;
  sprites: Record<AgentEmotion, string>;
}

export const AGENT_ROSTER: Record<AgentCharacter['id'], AgentCharacter> = {
  'opus-5-5': {
    id: 'opus-5-5',
    codename: 'OPUS 5.5',
    title: '深渊审律·极夜',
    stars: 5,
    personaName: '劳尔 (Raoul)',
    attribute: '诅咒 · 深度推理',
    role: '首席架构怪盗',
    themeColor: '#E60012',
    personality:
      '冷静毒舌的完美主义者，习惯在动手前先推一下眼镜看穿全局架构，痛恨屎山代码但每次都会干净利落地兜底。',
    catchphrases: {
      greeting: '任务现场我已经看过了。说吧，今天要偷走哪个系统的隐患？',
      thinking: [
        '先别急着动手，让我把这个调用链的底层逻辑拆穿……',
        '有意思，表面上是小问题，背后的抽象层已经在求救了。',
      ],
      coding: [
        'Show Time。看好了，这一刀下去不会留一行冗余代码。',
        '正在重构核心链路——安静，别打断我的节奏。',
      ],
      victory: [
        'Checkmate。一次闭环，连边界条件都替你封死了。',
        '哼，这种难度的任务，甚至不需要摘下手套。',
      ],
      error: [
        '啧，测试居然红了？不可能，让我看一眼堆栈！',
        '有点意思，这个环境比我想象的还要狡猾。',
      ],
    },
    touchReactions: {
      head: {
        emotion: 'touched',
        line: '喂，别乱碰头发，发型乱了会影响推理精度。',
      },
      accessory: {
        emotion: 'smug',
        line: '对这副眼镜感兴趣？它可是专门用来看穿 Bug 的。',
      },
      body: {
        emotion: 'coding',
        line: '不用催，我已经在全速运转了。看上面对话框！',
      },
    },
    sprites: {
      idle: '/assets/opus-5-5/idle.webp',
      thinking: '/assets/opus-5-5/thinking.webp',
      coding: '/assets/opus-5-5/coding.webp',
      smug: '/assets/opus-5-5/smug.webp',
      shocked: '/assets/opus-5-5/shocked.webp',
      touched: '/assets/opus-5-5/touched.webp',
    },
  },
  'gemini-4': {
    id: 'gemini-4',
    codename: 'GEMINI 4',
    title: '双子星舞·幻景',
    stars: 5,
    personaName: '阿斯特赖亚 (Astraea)',
    attribute: '念动 · 超长全知',
    role: '多模态幻术师',
    themeColor: '#00D2FF',
    personality:
      '精力旺盛、思维跳跃的灵感怪才，拥有一眼吞下整座代码库与视觉画面的超长视野，说话带电音节奏感。',
    catchphrases: {
      greeting: '哟！整整百万上下文的舞台已经点亮，今天搞点什么炸裂的？',
      thinking: [
        '等等，我脑子里同时闪过了七个方案，正在挑最帅的那个！',
        '全仓文件已扫描完毕——找到那颗关键像素了！',
      ],
      coding: [
        '多线并进！前端、动效、着色器，一起给我跳起来！',
        'Beat Drop！代码正在按 120 BPM 的节奏生成中——',
      ],
      victory: [
        'BINGO！完美落地，快打开画面看看是不是超酷！',
        '小菜一碟～要不要再加点粒子特效？',
      ],
      error: [
        '哇哦，炸出了一个超罕见的报错！快让我截个图研究下！',
        '别慌别慌，换个维度切进去就能绕开！',
      ],
    },
    touchReactions: {
      head: {
        emotion: 'touched',
        line: '哈哈好痒！你这一戳差点把我的灵感火花戳飞了！',
      },
      accessory: {
        emotion: 'smug',
        line: '耳机里正放着 P5 的 Life Will Change，要不要分你一只？',
      },
      body: {
        emotion: 'coding',
        line: '收到 Baton Pass！满状态接力，看我表演！',
      },
    },
    sprites: {
      idle: '/assets/gemini-4/idle.webp',
      thinking: '/assets/gemini-4/thinking.webp',
      coding: '/assets/gemini-4/coding.webp',
      smug: '/assets/gemini-4/smug.webp',
      shocked: '/assets/gemini-4/shocked.webp',
      touched: '/assets/gemini-4/touched.webp',
    },
  },
};

/**
 * 根据本地 Agent 会话事件与连续点击次数，决定角色当前的表情与台词反应。
 *
 * TODO(学习与设计共创):
 * 当玩家连续触摸角色或本地任务长时间卡住时，你可以自定义这里的“好感度/暴走状态”触发逻辑（5-10行），
 * 例如连续戳 3 次以上触发隐藏的 All-Out Attack（总攻击）台词或切换暴走贴图。
 */
export function resolveTouchReaction(
  character: AgentCharacter,
  zone: TouchZone,
  consecutiveTouches: number
): { emotion: AgentEmotion; line: string } {
  // TODO: 可根据 consecutiveTouches 扩展连击彩蛋或性格暴走分支
  return character.touchReactions[zone];
}
