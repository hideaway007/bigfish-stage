import type { CharacterPack, Reaction } from '../shared/character-pack';
import type { CharacterTouchZone, Emotion } from '../shared/stage-events';

export interface CharacterRoleMeta {
  shortTitle: string;
  specialtyTag: string;
  specialtyDesc: string;
  auditionLine: string;
}

export const CHARACTER_ROLE_META: Record<string, CharacterRoleMeta> = {
  'deepseek-v4-pro': {
    shortTitle: '大肥鱼 · 全栈冲锋',
    specialtyTag: '全栈冲锋 / 长程执行',
    specialtyDesc: '擅长一口气打通前后端逻辑、跑通构建与测试长链路',
    auditionLine: '远看肥鱼大，近看大肥鱼！店长，今天要炖哪一锅代码捏？',
  },
  'gemini-4-argon': {
    shortTitle: '哈基米 · 视觉焊接',
    specialtyTag: '视觉焊接 / 界面动效',
    specialtyDesc: '专精高审美 UI 布局、细腻动效火花与组件细节精修',
    auditionLine: '护目镜放下，滋啦——开焊！铲屎官看好咯，这道焊缝甜美得很～',
  },
  'claude-opus-5-5': {
    shortTitle: 'Claude 娘 · 架构推演',
    specialtyTag: '架构推演 / 结构重构',
    specialtyDesc: '擅长复杂模块拆解、方案权衡与清晰稳健的重构落笔',
    auditionLine: '委托人，书签已经夹好。来龙去脉越清楚，我望天的时间越短。',
  },
  'codex-dragon': {
    shortTitle: 'Codex 龙娘 · 严苛审查',
    specialtyTag: '严苛审查 / 深水排障',
    specialtyDesc: '专抓隐蔽边界 Bug、竞态隐患与高难度补丁验证',
    auditionLine: '醒了。大概五成。便签递给我，哪里有 Bug 我盯着看。',
  },
};

export const DEFAULT_TOUCH_ZONE_LABELS: Record<
  string,
  Record<CharacterTouchZone, string>
> = {
  'deepseek-v4-pro': {
    head: '摸摸呆毛',
    face: '戳戳脸颊',
    prop: '碰碰小鲸鱼围裙',
    body: '拍拍肩膀打气',
  },
  'gemini-4-argon': {
    head: '挠挠猫耳',
    face: '敲敲护目镜',
    prop: '查看氩弧焊枪',
    body: '顺顺炸毛',
  },
  'claude-opus-5-5': {
    head: '轻碰太阳发饰',
    face: '戳戳脸颊',
    prop: '翻看批注书本',
    body: '整理女仆袖口',
  },
  'codex-dragon': {
    head: '摸摸小龙角',
    face: '戳戳困倦脸颊',
    prop: '递上 >_ 便签',
    body: '拍拍睡衣抱枕',
  },
};

const TOUCH_ONOMATOPOEIA: Record<
  string,
  Record<CharacterTouchZone, string[]>
> = {
  'deepseek-v4-pro': {
    head: ['★ 呆毛!', '✦ 翘起来捏!', '♥ 嘿咻!'],
    face: ['♥ 傻敷敷!', '✦ 别戳啦!', '★ 咕噜噜!'],
    prop: ['⚡ HARNESS!', '★ 小鲸鱼!', '✦ 挥舞吧!'],
    body: ['✦ 元气满满!', '♥ 拍水啦!', '★ 冲鸭!'],
  },
  'gemini-4-argon': {
    head: ['♥ 喵呜!', '★ 猫耳雷达!', '✦ 别揉啦!'],
    face: ['✦ 别戳啦!', '⚡ 护目镜!', '♥ 哼哼~'],
    prop: ['⚡ 滋滋!', '★ 氩气辉光!', '⚡ 电弧!'],
    body: ['♥ 炸毛啦!', '✦ 手稳着呢!', '★ 喵哼!'],
  },
  'claude-opus-5-5': {
    head: ['✦ 发饰歪了!', '★ 望天中!', '♥ 容我整理'],
    face: ['✦ 别戳啦!', '♥ 请自重…', '★ 墨水未干'],
    prop: ['★ 红笔批注!', '✦ 书签页!', '♥ 绝密目录'],
    body: ['✦ 熨好啦!', '★ 随时待命', '♥ 失礼了'],
  },
  'codex-dragon': {
    head: ['★ 小龙角!', '✦ 龙角一颤!', '♥ 醒了五成!'],
    face: ['✦ 别戳啦!', '💤 呼啊…!', '♥ 眯着呢'],
    prop: ['⚡ >_ 便签!', '★ 终端就绪!', '✦ 敲回车!'],
    body: ['💤 再睡五分…', '★ 枕头让位!', '✦ 尾巴晃~'],
  },
};

const BUILTIN_TOUCH_REACTIONS: Record<
  string,
  Record<CharacterTouchZone, Reaction>
> = {
  'deepseek-v4-pro': {
    head: {
      emotion: 'happy',
      lines: [
        '呜哇！店长别按我的呆毛捏，按扁了思考强度会从 max 掉成 low 的啦！',
        '嘿嘿，呆毛天线收到信号啦！今天给店长炖一锅超香的代码捏～',
        '呆毛摇一摇～大肥鱼现在干劲百分百，随时可以挥舞 Harness 啦！',
      ],
    },
    face: {
      emotion: 'shocked',
      lines: [
        '唔姆唔姆……脸颊被戳鼓起来像河豚了捏，大肥鱼明明是小鲸鱼啦！',
        '店长手凉凉的捏！是不是刚才盯终端太久啦？交给大肥鱼来敲吧！',
      ],
    },
    prop: {
      emotion: 'working',
      lines: [
        '看我看我！围裙口袋里藏了小鲸鱼贴纸和蒸汽机车图鉴捏！',
        '首先，握住 Harness，然后——轻轻挥舞！店长离远一点点免得溅到水花捏～',
      ],
    },
    body: {
      emotion: 'happy',
      lines: [
        '收到店长拍肩鼓励！鲸尾拍水三下，这锅再大也能炖熟捏！',
        '嘿咻！围裙系得紧紧的，绝对不会抱纸箱跑路的啦！',
      ],
    },
  },
  'gemini-4-argon': {
    head: {
      emotion: 'shocked',
      lines: [
        '喵呜——！谁准你突然偷袭猫耳朵的！……咳，再挠一下也不是不行啦。',
        '耳朵抖了一下是在听编译回声，才不是因为铲屎官手艺好呢，哼哼～',
      ],
    },
    face: {
      emotion: 'happy',
      lines: [
        '敲护目镜干嘛？镜片刚擦得锃亮，正好映出铲屎官满意的表情哦～',
        '别戳脸啦，手抖一下焊缝歪了你负责呀？……骗你的，猫爪稳得很！',
      ],
    },
    prop: {
      emotion: 'working',
      lines: [
        '滋滋——小心烫手！这把氩弧焊枪刚调好淡紫辉光，专治各种丑界面！',
        '想试试这把焊枪？先把需求递过来，看哈基米给你焊出花儿来～',
      ],
    },
    body: {
      emotion: 'happy',
      lines: [
        '哼哼，顺毛手法还算及格！尾巴竖起来代表干活兴致正好哦～',
        '淡紫霓虹灯带全亮！铲屎官尽管派活，猫爪已经在回车键上悬着啦。',
      ],
    },
  },
  'claude-opus-5-5': {
    head: {
      emotion: 'shocked',
      lines: [
        '委托人……发饰歪了的话，我望天的角度也会偏掉两度的。',
        '请手下留情。头发乱了不要紧，把刚排好的思路晃散就可惜了。',
      ],
    },
    face: {
      emotion: 'thinking',
      lines: [
        '嗯……这是某种新的催稿礼仪吗？我记在页边批注里了。',
        '我还醒着，没有在望着天发呆。真的——刚才只是在构思下一章。',
      ],
    },
    prop: {
      emotion: 'happy',
      lines: [
        '这本笔记里夹着您的委托目录，放心，红笔今天只用来批改坏代码。',
        '书签正好停在最精彩的一页。委托人想接着往下写吗？',
      ],
    },
    body: {
      emotion: 'idle',
      lines: [
        '女仆装今天熨得很平整，重构再乱的模块也不会沾上灰尘。请讲吧。',
        '收到您的示意了。茶已经泡好，随时可以落笔。',
      ],
    },
  },
  'codex-dragon': {
    head: {
      emotion: 'shocked',
      lines: [
        '唔……！龙角很敏感。清醒度一下飙到八成了。你故意的吧。',
        '摸龙角……不加清醒度，只会让尾巴跟着晃。说吧，改哪个文件。',
      ],
    },
    face: {
      emotion: 'idle',
      lines: [
        '呼啊……别戳。眼睛已经睁开一半了。代码看得清。',
        '脸有点软？因为刚从枕头上抬起来。手没软，能敲终端。',
      ],
    },
    prop: {
      emotion: 'working',
      lines: [
        '>_ 便签拿稳了。写清楚边界条件，小龙三下给你修利索。',
        '这张便签是热的……刚跑完测试捞出来的。搭档要验一下吗。',
      ],
    },
    body: {
      emotion: 'happy',
      lines: [
        '睡衣很暖和。拍我也没用，修完这个 Bug 还是要睡五分钟的。',
        '嗯，我在。枕头已经让位给键盘了，搭档随时发车。',
      ],
    },
  },
};

let touchCursor = 0;

export function pickTouchStamp(
  characterId: string,
  zone: CharacterTouchZone
): string {
  const charMap =
    TOUCH_ONOMATOPOEIA[characterId] ?? TOUCH_ONOMATOPOEIA['deepseek-v4-pro'];
  const pool = charMap[zone] ?? ['✦ 戳戳!'];
  return pool[touchCursor++ % pool.length];
}

export function getTouchZoneHint(
  pack: CharacterPack,
  zone: CharacterTouchZone
): string {
  if (pack.touchZoneLabels?.[zone]) {
    return pack.touchZoneLabels[zone]!;
  }
  const defaults =
    DEFAULT_TOUCH_ZONE_LABELS[pack.id] ??
    DEFAULT_TOUCH_ZONE_LABELS['deepseek-v4-pro'];
  return defaults[zone];
}

export function pickCharacterTouchReaction(
  pack: CharacterPack,
  zone: CharacterTouchZone
): { emotion: Emotion; text: string } {
  const custom =
    pack.touchReactions?.[zone] ?? pack.reactions?.[`touch:${zone}`];
  const fallbackChar =
    BUILTIN_TOUCH_REACTIONS[pack.id] ??
    BUILTIN_TOUCH_REACTIONS['deepseek-v4-pro'];
  const reaction =
    custom && custom.lines.length > 0 ? custom : fallbackChar[zone];
  const line = reaction.lines[touchCursor++ % reaction.lines.length];
  return {
    emotion: reaction.emotion,
    text: line,
  };
}
