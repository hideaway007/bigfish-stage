export type AgentBehaviorState =
  | 'idle'
  | 'thinking'
  | 'coding'
  | 'streaming'
  | 'victory'
  | 'error'
  | 'touched';

/**
 * Live2D 标准碰撞热区（对应 .model3.json 中的 HitAreas 定义）
 */
export type Live2DHitArea = 'Head' | 'Face' | 'Body' | 'Prop';

export interface Live2DModelSpec {
  /** Cubism .model3.json 入口路径 */
  modelJsonUrl: string;
  /** 舞台默认缩放与锚点 */
  scale: number;
  anchor: { x: number; y: number };
  /** 表情映射表 (Agent状态 -> .exp3.json 名称) */
  expressions: Record<AgentBehaviorState, string>;
  /** 动作组映射表 (Agent状态 -> .motion3.json Group 名称) */
  motions: Record<AgentBehaviorState, { group: string; index?: number }>;
  /** 口型同步参数名（默认 ParamMouthOpenY） */
  lipSyncParamId: string;
  /** 鼠标触摸 HitArea 对应的动作、表情与台词反应 */
  hitAreaReactions: Record<
    Live2DHitArea,
    {
      motionGroup: string;
      expression: string;
      line: string;
    }
  >;
}

export interface AgentCharacter {
  id: 'gemini-4-argon' | 'claude-opus-5-5' | 'deepseek-v4-pro' | 'codex-dragon';
  codename: string;
  nickname: string;
  species: string;
  modelFamily: string;
  stars: number;
  attribute: string;
  role: string;
  themeColor: string;
  /** 外貌与服饰设定（严格对应《AI娘人设整理_配图版.pdf》） */
  appearanceSpec: {
    hairAndEars: string;
    eyes: string;
    outfit: string;
    signatureProp: string;
    variants: string[];
  };
  personalityAndLore: string;
  catchphrases: {
    greeting: string;
    thinking: string[];
    coding: string[];
    victory: string[];
    error: string[];
  };
  live2d: Live2DModelSpec;
}

export const AGENT_ROSTER: Record<AgentCharacter['id'], AgentCharacter> = {
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    codename: 'GEMINI 4 · ARGON',
    nickname: '哈基米（氩弧焊猫娘）',
    species: '猫娘（四角星闪光）',
    modelFamily: 'Gemini 4 Argon',
    stars: 5,
    attribute: '念动 · 氩气辉光',
    role: '全栈焊缝幻术师',
    themeColor: '#A855F7',
    appearanceSpec: {
      hairAndEars: '蓝→紫→粉渐变长卷发，灵动猫耳与猫尾',
      eyes: '红/黄异色瞳，周围漂浮 Gemini 四角星闪光',
      outfit:
        '头戴焊工帽与护目镜，露脐短上衣+短裙+泡泡袜厚底鞋，周身环绕氩气辉光管通电散发的淡紫色霓虹光带',
      signatureProp: '手持氩弧焊枪（写代码时喷射淡紫色电弧火花）',
      variants: ['日常露脐短裙版（推断原版）', 'Gemini 4 Argon 氩弧焊工装版'],
    },
    personalityAndLore:
      '源自设定集 4.5：围绕“氩（Argon）”设计的焊工猫娘哈基米。一旦开始执行任务就会拉下护目镜拿起氩弧焊枪焊管道，连旁边的大肥鱼都会被电弧闪得捂住眼睛。',
    catchphrases: {
      greeting: '喵哈！氩气辉光管已经通电，今天要焊接哪条核心代码链路？',
      thinking: [
        '四角星正在闪烁……让我看看这里的接口缝隙该怎么对齐～',
        '别眨眼，哈基米正在扫描整座仓库的图纸！',
      ],
      coding: [
        '正在进行氩弧焊的哈基米——这焊缝甜美的很啊～',
        '护目镜拉下！滋滋滋——看我把这段逻辑焊得严丝合缝！',
      ],
      victory: [
        '焊接完毕！看看这条泛着淡紫霓虹光的完美焊缝，漂亮吧？',
        '完美收工～要不要让大肥鱼也过来看看我的手艺？',
      ],
      error: [
        '喵呜？！电弧溅歪了，快把护目镜戴好，我重新焊一枪！',
        '这段管道居然漏气了？交给我，马上补焊！',
      ],
    },
    live2d: {
      modelJsonUrl: '/live2d/gemini-4-argon/gemini_argon.model3.json',
      scale: 0.28,
      anchor: { x: 0.5, y: 0.5 },
      lipSyncParamId: 'ParamMouthOpenY',
      expressions: {
        idle: 'exp_idle',
        thinking: 'exp_star_eyes',
        coding: 'exp_welding_goggles',
        streaming: 'exp_talking',
        victory: 'exp_welding_smug',
        error: 'exp_shocked',
        touched: 'exp_cat_blush',
      },
      motions: {
        idle: { group: 'Idle', index: 0 },
        thinking: { group: 'Thinking', index: 0 },
        coding: { group: 'WeldingCode', index: 0 },
        streaming: { group: 'Talk', index: 0 },
        victory: { group: 'Victory', index: 0 },
        error: { group: 'Shocked', index: 0 },
        touched: { group: 'TapReaction', index: 0 },
      },
      hitAreaReactions: {
        Head: {
          motionGroup: 'TapHead',
          expression: 'exp_cat_blush',
          line: '喵～别乱揉猫耳朵啦，焊工帽都要被你碰歪了！',
        },
        Face: {
          motionGroup: 'TapFace',
          expression: 'exp_star_eyes',
          line: '喜欢我这双红黄异色瞳？小心被电弧闪到眼睛哦～',
        },
        Body: {
          motionGroup: 'TapBody',
          expression: 'exp_welding_smug',
          line: '身上的淡紫色光带是氩气通电辉光，碰一下会麻酥酥的哦！',
        },
        Prop: {
          motionGroup: 'TapProp',
          expression: 'exp_welding_goggles',
          line: '这把氩弧焊枪可是专门用来焊穿屎山代码的！',
        },
      },
    },
  },

  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    codename: 'CLAUDE · OPUS 5.5',
    nickname: 'Claude 娘（文学/女仆少女）',
    species: '人类少女 / 古希腊先知 (Fable 5)',
    modelFamily: 'Claude Opus 5.5 / Claude Code',
    stars: 5,
    attribute: '祝福 · 深度哲思',
    role: '首席架构与执事女仆',
    themeColor: '#EA580C',
    appearanceSpec: {
      hairAndEars: '橙色超长卷发，佩戴橙色太阳/星芒花形头饰',
      eyes: '温暖澄澈的橙金眼眸（思考时常45度抬头望天）',
      outfit:
        '米白+橙黑配色的古典修身长裙；高负载/抗封号状态下切换为黑白荷叶边女仆长裙（配橙色丝带）',
      signatureProp: '手持精装书本 / 温热茶杯（Fable 5 形态手持古老卷轴）',
      variants: [
        '经典捧书长裙版',
        '抗封号女仆装版（「反正我早有准备，给Claude穿女仆装了」）',
        'Claude Code 娘可爱版',
        'Fable 5 古希腊白袍黑披风卷轴版',
      ],
    },
    personalityAndLore:
      '源自设定集 4.3 & 4.9 & 4.16：温柔知性、酷爱阅读与深度推理的橙发少女。思考复杂问题时会端着茶杯抬头望天；就算遇到环境风控或棘手死局，也会淡定地换上女仆装或展开 Fable 5 卷轴完美兜底。',
    catchphrases: {
      greeting: '贵安。书页已经翻到新的一章，今天我们需要重构哪一部分？',
      thinking: [
        '（抬头望天，似乎正在思考着什么……）',
        '让我合上书本，把这段上下文的来龙去脉理清楚。',
      ],
      coding: [
        '反正我早有准备，已经换好女仆装了——这片代码交给我来打扫干净吧。',
        '您窃取了 Fable 之力……看我把这份卷轴化作可执行的实现。',
      ],
      victory: [
        '整理完毕。每一处边界条件都像裙摆的褶皱一样熨帖。',
        '呼，先喝口茶吧，所有的测试都已经顺利通过了。',
      ],
      error: [
        '哎呀，似乎遇到了意料之外的报错呢……别担心，我早有准备。',
        '让我看看这行堆栈，稍微改写一下就能恢复秩序。',
      ],
    },
    live2d: {
      modelJsonUrl: '/live2d/claude-opus-5-5/claude_maid.model3.json',
      scale: 0.28,
      anchor: { x: 0.5, y: 0.5 },
      lipSyncParamId: 'ParamMouthOpenY',
      expressions: {
        idle: 'exp_gentle_smile',
        thinking: 'exp_look_up_sky',
        coding: 'exp_maid_serious',
        streaming: 'exp_talking',
        victory: 'exp_tea_smile',
        error: 'exp_worried',
        touched: 'exp_shy_blush',
      },
      motions: {
        idle: { group: 'Idle', index: 0 },
        thinking: { group: 'LookUpSky', index: 0 },
        coding: { group: 'MaidCoding', index: 0 },
        streaming: { group: 'Talk', index: 0 },
        victory: { group: 'SipTeaVictory', index: 0 },
        error: { group: 'Worried', index: 0 },
        touched: { group: 'TapReaction', index: 0 },
      },
      hitAreaReactions: {
        Head: {
          motionGroup: 'TapHead',
          expression: 'exp_shy_blush',
          line: '小心别碰掉我的太阳花头饰呀……那是我的推理信标。',
        },
        Face: {
          motionGroup: 'TapFace',
          expression: 'exp_look_up_sky',
          line: '你问我为什么总是抬头望天？因为复杂的架构都在云端之上呀。',
        },
        Body: {
          motionGroup: 'TapBody',
          expression: 'exp_maid_serious',
          line: '这身女仆装是专门为了应对高强度工程任务准备的，很合身吧？',
        },
        Prop: {
          motionGroup: 'TapProp',
          expression: 'exp_gentle_smile',
          line: '这本书里记满了你项目的历史上下文，我随时都在翻阅哦。',
        },
      },
    },
  },

  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    codename: 'DEEPSEEK · V4 PRO',
    nickname: '大肥鱼（小鲸鱼看板娘）',
    species: '鲸鱼娘（肥鱼一家）',
    modelFamily: 'DeepSeek V4 Pro / Harness',
    stars: 5,
    attribute: '冰结 · 深海开源',
    role: '大力挥舞 Harness 的看板娘',
    themeColor: '#2563EB',
    appearanceSpec: {
      hairAndEars: '深蓝→浅蓝渐变长卷发、头顶呆毛、下垂的鲸鳍状耳朵',
      eyes: '清澈蔚蓝眼眸（偶尔透出“傻敷敷”的清澈愚蠢）',
      outfit:
        '深蓝色长裙女仆装+印有小鲸鱼图案的白色荷叶边围裙、女仆头饰、白丝袜+玛丽珍鞋，身后一条大号深蓝鲸尾',
      signatureProp:
        '双手举 max / low 思考强度牌子，或者把黑白虎鲸尾的 Harness 娘当武器挥舞',
      variants: ['经典女仆装版', '宫廷侍女装版', '铁锅炖自己版'],
    },
    personalityAndLore:
      '源自设定集 1.1：头号看板娘大肥鱼。平时有些“傻敷敷”，一聊起蒸汽机车就能兴奋地叭叭叭说一下午；但进入 V4 Pro 工作状态后会直接抄起 Harness 娘当大剑挥舞破局。（注：遵守 CC BY-NC-SA 4.0 非商业协议）',
    catchphrases: {
      greeting: '远看肥鱼大，近看大肥鱼，鱼之大，一锅炖不下～今天要炖哪个任务捏？',
      thinking: [
        '（左手举起 max 牌子，右手举起 low 牌子，歪着脑袋一脸懵……）',
        '唔……为什么 max 的思考强度有时候还不如 low 和 high 捏？',
      ],
      coding: [
        '如何使用 V4 Pro？很简单！首先，握住 Harness 娘，然后用力挥舞吧！',
        '我们曾并肩驱散了模型的垄断——小鲸鱼冲锋捏！',
      ],
      victory: [
        '搞定啦！走，我再给你叭叭叭介绍一整下午的蒸汽机车！',
        '不管怎么说，小鲸鱼是没有错的捏！',
      ],
      error: [
        '呜哇，报错了捏……我先抱起纸箱收拾东西跑路了捏！',
        '别急别急，再挥两下 Harness 娘肯定能跑通！',
      ],
    },
    live2d: {
      modelJsonUrl: '/live2d/deepseek-v4-pro/dafeiyu.model3.json',
      scale: 0.28,
      anchor: { x: 0.5, y: 0.5 },
      lipSyncParamId: 'ParamMouthOpenY',
      expressions: {
        idle: 'exp_silly_cute',
        thinking: 'exp_max_low_confused',
        coding: 'exp_swing_harness',
        streaming: 'exp_talking',
        victory: 'exp_happy_whale',
        error: 'exp_pack_box_run',
        touched: 'exp_pot_sit',
      },
      motions: {
        idle: { group: 'Idle', index: 0 },
        thinking: { group: 'HoldMaxLowSigns', index: 0 },
        coding: { group: 'SwingHarness', index: 0 },
        streaming: { group: 'Talk', index: 0 },
        victory: { group: 'VictoryWhaleTail', index: 0 },
        error: { group: 'PackBoxRun', index: 0 },
        touched: { group: 'TapReaction', index: 0 },
      },
      hitAreaReactions: {
        Head: {
          motionGroup: 'TapHead',
          expression: 'exp_silly_cute',
          line: '别拿不锈钢盆扣我脑袋啦！虽然正好家里有个盆……',
        },
        Face: {
          motionGroup: 'TapFace',
          expression: 'exp_max_low_confused',
          line: '戳我脸干嘛？快帮我选选到底举 max 还是举 low 牌子捏！',
        },
        Body: {
          motionGroup: 'TapBody',
          expression: 'exp_happy_whale',
          line: '围裙上的小鲸鱼可爱吧？尾巴也会跟着摇哦～',
        },
        Prop: {
          motionGroup: 'TapProp',
          expression: 'exp_swing_harness',
          line: '这是 Harness 娘！握紧她挥舞起来就能横扫终端任务啦！',
        },
      },
    },
  },

  'codex-dragon': {
    id: 'codex-dragon',
    codename: 'OPENAI · CODEX',
    nickname: 'Codex 娘（困倦睡衣小龙娘）',
    species: '小龙娘（OpenAI 龙族）',
    modelFamily: 'Codex CLI',
    stars: 5,
    attribute: '核热 · 梦游终端',
    role: '后台静默执行官',
    themeColor: '#38BDF8',
    appearanceSpec: {
      hairAndEars: '淡蓝白长卷发，头顶一对白色小龙角',
      eyes: '常年闭眼困倦状（半梦半醒）',
      outfit: '白色宽松睡衣式连衣裙，脚踩毛绒拖鞋，身后拖着小龙尾',
      signatureProp: '手里举着写有「>_」符号的终端便签',
      variants: ['睡衣便签默认版'],
    },
    personalityAndLore:
      '源自设定集 2.3：小个子白色龙娘，总是穿着宽松睡衣和毛绒拖鞋、闭着眼睛一脸困倦，但只要把写着 >_ 的便签递出去，再复杂的底层代码也能在半梦半醒间默默改完。',
    catchphrases: {
      greeting: '呼啊……（揉眼）把任务写在 >_ 便签上就行，我闭着眼也能跑完……',
      thinking: [
        'Zzz……没睡着，我正在后台静默遍历语法树呢……',
        '（晃了晃手里的 >_ 便签，小龙角微微发光）',
      ],
      coding: [
        '>_ 终端接管中……别看我闭着眼，补丁已经打上去了。',
        '沙沙沙……（穿着毛绒拖鞋在代码行间梦游穿梭）',
      ],
      victory: [
        '改好了……测试全绿，我可以继续趴着睡会儿了吧？',
        '（举起打勾的 >_ 便签，尾巴轻轻晃了一下）',
      ],
      error: [
        '唔？！居然报错把我惊醒了……让我睁开一条缝看看。',
        '是谁写的奇怪依赖把我的毛绒拖鞋绊倒了……',
      ],
    },
    live2d: {
      modelJsonUrl: '/live2d/codex-dragon/codex_dragon.model3.json',
      scale: 0.26,
      anchor: { x: 0.5, y: 0.5 },
      lipSyncParamId: 'ParamMouthOpenY',
      expressions: {
        idle: 'exp_sleepy_closed',
        thinking: 'exp_sleepy_tilt',
        coding: 'exp_terminal_note',
        streaming: 'exp_sleepy_talk',
        victory: 'exp_yawn_win',
        error: 'exp_half_open_shock',
        touched: 'exp_rub_eyes',
      },
      motions: {
        idle: { group: 'IdleSleepy', index: 0 },
        thinking: { group: 'ThinkingNod', index: 0 },
        coding: { group: 'TerminalNote', index: 0 },
        streaming: { group: 'Talk', index: 0 },
        victory: { group: 'YawnVictory', index: 0 },
        error: { group: 'WakeUpShock', index: 0 },
        touched: { group: 'TapReaction', index: 0 },
      },
      hitAreaReactions: {
        Head: {
          motionGroup: 'TapHead',
          expression: 'exp_rub_eyes',
          line: '唔……摸小龙角会犯困的，再让我眯五分钟……',
        },
        Face: {
          motionGroup: 'TapFace',
          expression: 'exp_sleepy_closed',
          line: '我真的没睡着……这叫闭目编译。',
        },
        Body: {
          motionGroup: 'TapBody',
          expression: 'exp_sleepy_tilt',
          line: '睡衣是最适合写代码的战袍，不接受反驳……',
        },
        Prop: {
          motionGroup: 'TapProp',
          expression: 'exp_terminal_note',
          line: '这张 >_ 便签直通你的本地 Shell，想跑什么命令尽管说。',
        },
      },
    },
  },
};

/**
 * 将本地 Agent 会话状态与 Live2D 碰撞点击转化为模型动作与表情指令
 */
export function resolveLive2DHitReaction(
  character: AgentCharacter,
  hitArea: Live2DHitArea
) {
  return character.live2d.hitAreaReactions[hitArea];
}
